import fs from 'fs'
import path from 'path'
import { GoogleGenAI } from '@google/genai'

// Ensure .env.local variables are loaded if not already provided
function loadEnv() {
  if (!process.env.GEMINI_API_KEY) {
    const envPath = path.join(process.cwd(), '.env.local')
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8')
      for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (trimmed && !trimmed.startsWith('#')) {
          const idx = trimmed.indexOf('=')
          if (idx !== -1) {
            const key = trimmed.slice(0, idx).trim()
            const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
            if (!process.env[key]) {
              process.env[key] = val
            }
          }
        }
      }
    }
  }
}
loadEnv()

// 1. Exact V1 Few-Shot System Prompt (identical to lib/ai-orchestrator.ts)
const SEVERITY_SYSTEM_PROMPT = `You are an expert software triage engineer.
Classify the software bug report into one of four severities: Critical, High, Medium, Low.
Provide a 1-sentence reason and a confidence score between 0.0 and 1.0.

Guidelines:
- Critical: Total service outage, data corruption, financial loss, or critical vulnerability.
- High: Major feature broken with no workaround, severe performance degradation, or frequent crashes.
- Medium: Functional defect with a workaround, cosmetic issue affecting core flow, or edge case failure.
- Low: Minor visual glitch, typo, or minor usability inconvenience.

Few-shot examples:
Example 1:
Bug: "Database tables dropped on failed migration rollback; customer accounts missing."
Classification:
{"severity": "Critical", "confidence": 0.98, "reason": "Catastrophic data loss affecting active production users."}

Example 2:
Bug: "Checkout button throws unhandled 500 error when clicking with Stripe payment."
Classification:
{"severity": "High", "confidence": 0.92, "reason": "Core monetization pathway is completely blocked for customers."}

Example 3:
Bug: "Profile avatar upload fails for TIFF files, works for JPEG and PNG."
Classification:
{"severity": "Medium", "confidence": 0.85, "reason": "Edge-case file format restriction with obvious user workaround."}

Example 4:
Bug: "Dashboard header font size is 14px instead of 16px on Safari."
Classification:
{"severity": "Low", "confidence": 0.95, "reason": "Cosmetic typography discrepancy with zero functional impact."}

Respond ONLY with valid JSON with keys: "severity" ("Critical"|"High"|"Medium"|"Low"), "confidence" (number), "reason" (string).`

// 2. Exact Rule-Based Heuristic Baseline (identical to lib/ai-orchestrator.ts)
export function heuristicClassification(title, description) {
  const combined = `${title} ${description}`.toLowerCase()
  let severity = 'Medium'
  let confidence = 0.85
  let reason = 'Heuristic baseline analysis of keywords.'
  const tags = []

  if (combined.includes('leak') || combined.includes('crash') || combined.includes('corrupt') || combined.includes('security')) {
    severity = 'Critical'
    confidence = 0.90
    reason = 'Identified severe keywords indicating system instability or data jeopardy.'
    tags.push('crash')
  } else if (combined.includes('error 500') || combined.includes('checkout') || combined.includes('payment')) {
    severity = 'High'
    confidence = 0.88
    reason = 'Identified key transactional blockage affecting users.'
    tags.push('payment')
  } else if (combined.includes('typo') || combined.includes('color') || combined.includes('font') || combined.includes('margin')) {
    severity = 'Low'
    confidence = 0.94
    reason = 'Identified cosmetic layout or styling anomaly.'
    tags.push('ui')
  } else {
    severity = 'Medium'
    confidence = 0.55
    reason = 'Ambiguous symptom report; automated confidence is below review threshold.'
    tags.push('backend')
  }

  return {
    severity: { severity, confidence, reason },
    tags,
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function callGeminiClassification(ai, title, description, steps = null, maxRetries = 5) {
  const prefixRegex = /^\[[^\]]+\]\s*Bug\s*#?\d+:?\s*/i
  const cleanTitle = title.replace(prefixRegex, '')
  const cleanDescription = description.replace(prefixRegex, '')
  const bugContent = `Title: ${cleanTitle}\nDescription: ${cleanDescription}\nSteps to Reproduce: ${steps || 'N/A'}`
  const prompt = `${SEVERITY_SYSTEM_PROMPT}\n\nNow classify this bug:\n${bugContent}`

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: prompt,
        config: { responseMimeType: 'application/json', temperature: 0 },
      })

      let text = (res.text || '').trim()
      if (text.startsWith('```')) {
        text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      }

      const parsed = JSON.parse(text || '{}')
      if (!parsed.severity || typeof parsed.confidence !== 'number') {
        throw new Error(`Malformed AI JSON output: ${res.text}`)
      }

      return {
        severity: parsed.severity,
        confidence: parsed.confidence,
        reason: parsed.reason || 'Classification based on impact.',
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      const isRateLimit = errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('quota') || errMsg.includes('rate')
      const waitTime = isRateLimit ? Math.max(6000, 5000 * Math.pow(2, attempt - 1)) : 2000 * attempt

      console.warn(`\n[Gemini Attempt ${attempt}/${maxRetries} failed: ${errMsg.slice(0, 100)}... Backing off ${waitTime}ms]`)
      if (attempt < maxRetries) {
        await delay(waitTime)
      } else {
        throw err
      }
    }
  }
}

export async function runPredictionCaching() {
  const geminiKey = process.env.GEMINI_API_KEY
  if (!geminiKey) {
    console.error('ERROR: GEMINI_API_KEY is not set in environment or .env.local')
    process.exit(1)
  }

  const ai = new GoogleGenAI({ apiKey: geminiKey })

  // 1. Load the 5 dataset files
  const files = [
    'eclipse-dev.json',
    'mozilla-dev.json',
    'eclipse-heldout-balanced.json',
    'mozilla-heldout-balanced.json',
    'heldout-natural-pooled.json',
  ]

  const allBugs = []
  for (const file of files) {
    const filePath = path.join(process.cwd(), 'scripts', file)
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing dataset file: ${file}. Please run build-datasets.mjs first.`)
    }
    const bugs = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    bugs.forEach((b) => {
      allBugs.push({ ...b, sourceFile: file })
    })
  }

  console.log('========================================================================')
  console.log(`=== STAGE 2: PREDICTION CACHING PIPELINE (${allBugs.length} BUGS TOTAL) ===`)
  console.log('========================================================================\n')

  // 2. Load existing cache if present
  const cachePath = path.join(process.cwd(), 'scripts', 'predictions-cache.json')
  let cache = {}
  if (fs.existsSync(cachePath)) {
    try {
      cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'))
      console.log(`Found existing cache with ${Object.keys(cache).length} entries.`)
    } catch {
      cache = {}
    }
  }

  let newlyCached = 0
  let skipped = 0
  let failed = 0

  const total = allBugs.length

  for (let i = 0; i < total; i++) {
    const bug = allBugs[i]
    const existing = cache[bug.id]

    // Skip if already successfully cached
    if (existing && existing.status === 'success') {
      skipped++
      continue
    }

    const progress = `[${(i + 1).toString().padStart(3, '0')}/${total}]`
    process.stdout.write(`${progress} Caching ${bug.id} (${bug.sourceFile}, exp: ${bug.expectedSeverity})... `)

    // Compute rule-based baseline prediction
    const baselineResult = heuristicClassification(bug.title, bug.description)

    try {
      // Call Gemini with v1 prompt
      const llmResult = await callGeminiClassification(ai, bug.title, bug.description, bug.steps_to_reproduce || null)

      cache[bug.id] = {
        id: bug.id,
        sourceBugId: bug.sourceBugId,
        sourceFile: bug.sourceFile,
        component_group: bug.component_group,
        component: bug.component,
        expectedSeverity: bug.expectedSeverity,
        title: bug.title,
        description: bug.description,
        wordCount: bug.wordCount,
        llm: {
          severity: llmResult.severity,
          confidence: Number(llmResult.confidence.toFixed(4)),
          reason: llmResult.reason,
        },
        baseline: {
          severity: baselineResult.severity.severity,
          confidence: Number(baselineResult.severity.confidence.toFixed(4)),
          reason: baselineResult.severity.reason,
          tags: baselineResult.tags,
        },
        status: 'success',
        cachedAt: new Date().toISOString(),
      }

      newlyCached++
      process.stdout.write(`✓ LLM: ${llmResult.severity} (conf: ${llmResult.confidence.toFixed(2)}) | Base: ${baselineResult.severity.severity}\n`)
    } catch (err) {
      failed++
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error(`\nFAILED to classify ${bug.id}: ${errMsg}`)

      cache[bug.id] = {
        id: bug.id,
        sourceBugId: bug.sourceBugId,
        sourceFile: bug.sourceFile,
        component_group: bug.component_group,
        expectedSeverity: bug.expectedSeverity,
        baseline: {
          severity: baselineResult.severity.severity,
          confidence: Number(baselineResult.severity.confidence.toFixed(4)),
          reason: baselineResult.severity.reason,
        },
        status: 'failed',
        error: errMsg,
        cachedAt: new Date().toISOString(),
      }
    }

    // Incremental write to disk
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2))

    // Polite rate-limiting delay between calls (1.2 seconds)
    await delay(1200)
  }

  // 3. Compute Summary Statistics
  const cachedEntries = Object.values(cache)
  const successEntries = cachedEntries.filter((e) => e.status === 'success')
  const failedEntries = cachedEntries.filter((e) => e.status === 'failed')

  const llmDist = { Critical: 0, High: 0, Medium: 0, Low: 0 }
  const baseDist = { Critical: 0, High: 0, Medium: 0, Low: 0 }

  for (const entry of successEntries) {
    if (entry.llm?.severity) llmDist[entry.llm.severity] = (llmDist[entry.llm.severity] || 0) + 1
    if (entry.baseline?.severity) baseDist[entry.baseline.severity] = (baseDist[entry.baseline.severity] || 0) + 1
  }

  console.log('\n========================================================================')
  console.log('=== STAGE 2 CACHING COMPLETED ===')
  console.log('========================================================================')
  console.log(`Total Corpus Bugs:  ${total}`)
  console.log(`Successfully Cached: ${successEntries.length} (Skipped previously cached: ${skipped}, Newly cached: ${newlyCached})`)
  console.log(`Failed Predictions:  ${failedEntries.length}`)

  console.log('\n--- LLM (Gemini 3.6 Flash v1) Predicted Distribution ---')
  console.table([
    {
      Total: successEntries.length,
      Critical: `${llmDist.Critical} (${((llmDist.Critical / successEntries.length) * 100).toFixed(1)}%)`,
      High: `${llmDist.High} (${((llmDist.High / successEntries.length) * 100).toFixed(1)}%)`,
      Medium: `${llmDist.Medium} (${((llmDist.Medium / successEntries.length) * 100).toFixed(1)}%)`,
      Low: `${llmDist.Low} (${((llmDist.Low / successEntries.length) * 100).toFixed(1)}%)`,
    },
  ])

  console.log('\n--- Rule-Based Baseline Predicted Distribution ---')
  console.table([
    {
      Total: successEntries.length,
      Critical: `${baseDist.Critical} (${((baseDist.Critical / successEntries.length) * 100).toFixed(1)}%)`,
      High: `${baseDist.High} (${((baseDist.High / successEntries.length) * 100).toFixed(1)}%)`,
      Medium: `${baseDist.Medium} (${((baseDist.Medium / successEntries.length) * 100).toFixed(1)}%)`,
      Low: `${baseDist.Low} (${((baseDist.Low / successEntries.length) * 100).toFixed(1)}%)`,
    },
  ])

  return {
    total,
    successCount: successEntries.length,
    failedCount: failedEntries.length,
    llmDist,
    baseDist,
  }
}

const isMain = process.argv[1] && process.argv[1].endsWith('cache-predictions.mjs')
if (isMain) {
  runPredictionCaching().catch((err) => {
    console.error('Fatal caching error:', err)
    process.exit(1)
  })
}
