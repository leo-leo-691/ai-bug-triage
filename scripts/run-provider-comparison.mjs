import fs from 'fs'
import path from 'path'
import { TEST_SET } from './run-evaluation.mjs'
import { GoogleGenAI } from '@google/genai'
import OpenAI from 'openai'

// 1. Original v1 Prompt
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

// 2. Load Datasets
const diagnosticBugs = TEST_SET.filter(b => !b.isAmbiguous).map(b => ({
  id: `diag-${b.id}`,
  title: b.title,
  description: b.description,
  expectedSeverity: b.expectedSeverity,
  dataset: 'diagnostic'
}))

const datasetPath = path.join(process.cwd(), 'scripts', 'sampled_external_dataset.json')
const SAMPLED_DATASET = JSON.parse(fs.readFileSync(datasetPath, 'utf-8'))
const externalBugs = SAMPLED_DATASET.map(b => ({
  id: `ext-${b.id}`,
  title: b.title,
  description: b.description,
  expectedSeverity: b.expectedSeverity,
  dataset: 'external'
}))

const allBugs = [...diagnosticBugs, ...externalBugs]

// 3. Provider Functions
async function callGemini(bugContent) {
  const geminiKey = process.env.GEMINI_API_KEY
  if (!geminiKey) throw new Error('GEMINI_API_KEY not found')
  const ai = new GoogleGenAI({ apiKey: geminiKey })
  const res = await ai.models.generateContent({
    model: 'gemini-3.6-flash',
    contents: `${SEVERITY_SYSTEM_PROMPT}\n\nNow classify this bug:\n${bugContent}`,
    config: { responseMimeType: 'application/json', temperature: 0 },
  })
  return JSON.parse(res.text || '{}')
}

async function callOpenAI(bugContent) {
  const openaiKey = process.env.OPENAI_API_KEY
  if (!openaiKey) throw new Error('OPENAI_API_KEY not found')
  const openai = new OpenAI({ apiKey: openaiKey })
  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SEVERITY_SYSTEM_PROMPT },
      { role: 'user', content: bugContent },
    ],
  })
  return JSON.parse(res.choices[0].message.content || '{}')
}

async function callAnthropic(bugContent) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not found')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      temperature: 0,
      system: SEVERITY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: bugContent }]
    })
  })
  
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Anthropic API error: ${res.status} - ${errText}`)
  }

  const data = await res.json()
  let text = data.content?.[0]?.text || '{}'
  // Clean up any markdown json wrapping if present
  text = text.replace(/^```json/i, '').replace(/```$/, '').trim()
  return JSON.parse(text)
}

function stripPrefix(text) {
  const prefixRegex = /^\[[^\]]+\]\s*Bug\s*#?\d+:?\s*/i
  return text.replace(prefixRegex, '')
}

function calculateMetrics(records) {
  if (records.length === 0) return null

  let exactMatches = 0
  const total = records.length
  
  const SEVERITY_LEVELS = ['Critical', 'High', 'Medium', 'Low']
  const confusionMatrix = {}
  const perClass = {}

  for (const lvl of SEVERITY_LEVELS) {
    confusionMatrix[lvl] = { 'Critical': 0, 'High': 0, 'Medium': 0, 'Low': 0 }
    perClass[lvl] = { tp: 0, fp: 0, fn: 0 }
  }

  for (const r of records) {
    const exp = r.expectedSeverity
    const act = r.actualSeverity

    if (exp === act) exactMatches++
    
    if (confusionMatrix[exp] && confusionMatrix[exp][act] !== undefined) {
      confusionMatrix[exp][act]++
    }

    for (const lvl of SEVERITY_LEVELS) {
      if (exp === lvl && act === lvl) perClass[lvl].tp++
      else if (exp !== lvl && act === lvl) perClass[lvl].fp++
      else if (exp === lvl && act !== lvl) perClass[lvl].fn++
    }
  }

  const exactAccuracy = (exactMatches / total) * 100

  for (const lvl of SEVERITY_LEVELS) {
    const p = perClass[lvl]
    p.precision = p.tp + p.fp > 0 ? (p.tp / (p.tp + p.fp)) * 100 : 0
    p.recall = p.tp + p.fn > 0 ? (p.tp / (p.tp + p.fn)) * 100 : 0
    p.f1 = p.precision + p.recall > 0 ? (2 * p.precision * p.recall) / (p.precision + p.recall) : 0
  }

  return {
    total,
    exactAccuracy,
    confusionMatrix,
    perClass
  }
}

async function runComparison() {
  console.log('Starting standalone multi-provider comparison...')
  console.log(`Total bugs to process: ${allBugs.length} (18 diagnostic, 48 external)`)
  
  const providers = {
    'Gemini (gemini-3.6-flash)': callGemini,
    'OpenAI (gpt-4o-mini)': callOpenAI,
    'Anthropic (claude-haiku-4-5)': callAnthropic
  }

  const results = {
    gemini: [],
    openai: [],
    anthropic: []
  }

  const failures = {
    gemini: false,
    openai: false,
    anthropic: false
  }

  for (let i = 0; i < allBugs.length; i++) {
    const bug = allBugs[i]
    const cleanTitle = stripPrefix(bug.title)
    const cleanDescription = stripPrefix(bug.description)
    const bugContent = `Title: ${cleanTitle}\nDescription: ${cleanDescription}\nSteps to Reproduce: N/A`

    process.stdout.write(`\rProcessing bug ${i+1}/${allBugs.length}...`)

    // We make calls sequentially per provider to isolate failures and easily track
    if (!failures.gemini) {
      try {
        const res = await callGemini(bugContent)
        results.gemini.push({ ...bug, actualSeverity: res.severity, confidence: res.confidence, reason: res.reason })
      } catch (e) {
        console.error(`\nGemini failed on bug ${bug.id}:`, e.message)
        failures.gemini = true
      }
    }

    if (!failures.openai) {
      try {
        const res = await callOpenAI(bugContent)
        results.openai.push({ ...bug, actualSeverity: res.severity, confidence: res.confidence, reason: res.reason })
      } catch (e) {
        console.error(`\nOpenAI failed on bug ${bug.id}:`, e.message)
        failures.openai = true
      }
    }

    if (!failures.anthropic) {
      try {
        const res = await callAnthropic(bugContent)
        results.anthropic.push({ ...bug, actualSeverity: res.severity, confidence: res.confidence, reason: res.reason })
      } catch (e) {
        console.error(`\nAnthropic failed on bug ${bug.id}:`, e.message)
        failures.anthropic = true
      }
    }
  }

  console.log('\n\n===============================================================')
  console.log('              PROVIDER COMPARISON METRICS')
  console.log('===============================================================')

  const comparisonTable = []
  const outputPayload = {}

  for (const [providerKey, providerRecords] of Object.entries(results)) {
    if (failures[providerKey]) {
      console.log(`\n--- ${providerKey.toUpperCase()} (FAILED/INCOMPLETE) ---`)
      continue
    }

    const diagRecords = providerRecords.filter(r => r.dataset === 'diagnostic')
    const extRecords = providerRecords.filter(r => r.dataset === 'external')

    const diagMetrics = calculateMetrics(diagRecords)
    const extMetrics = calculateMetrics(extRecords)

    outputPayload[providerKey] = {
      diagnostic: diagMetrics,
      external: extMetrics,
      records: providerRecords
    }

    comparisonTable.push({
      'Provider': providerKey,
      'Diag Accuracy': `${diagMetrics.exactAccuracy.toFixed(1)}%`,
      'Diag Critical Recall': `${diagMetrics.perClass['Critical'].recall.toFixed(1)}%`,
      'Ext Accuracy': `${extMetrics.exactAccuracy.toFixed(1)}%`,
      'Ext Critical Recall': `${extMetrics.perClass['Critical'].recall.toFixed(1)}%`
    })

    console.log(`\n--- ${providerKey.toUpperCase()} METRICS ---`)
    console.log(`Diagnostic: Accuracy ${diagMetrics.exactAccuracy.toFixed(1)}% | Critical Recall: ${diagMetrics.perClass['Critical'].recall.toFixed(1)}%`)
    console.log(`External  : Accuracy ${extMetrics.exactAccuracy.toFixed(1)}% | Critical Recall: ${extMetrics.perClass['Critical'].recall.toFixed(1)}%`)
  }

  console.log('\n===============================================================')
  console.log('                 COMBINED COMPARISON SUMMARY')
  console.log('===============================================================')
  console.table(comparisonTable)

  const outputPath = path.join(process.cwd(), 'scripts', 'provider-comparison-results.json')
  fs.writeFileSync(outputPath, JSON.stringify(outputPayload, null, 2), 'utf-8')
  console.log(`\n✓ Successfully exported comparison results to: ${outputPath}`)
}

runComparison().catch(err => {
  console.error('Fatal comparison error:', err)
  process.exit(1)
})
