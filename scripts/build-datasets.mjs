import fs from 'fs'
import path from 'path'

// Seeded pseudorandom number generator (mulberry32) for deterministic, reproducible sampling
function createRng(seed = 42) {
  let s = seed >>> 0
  return function () {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle(array, rng) {
  const arr = [...array]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function parseCSV(content) {
  const lines = []
  let row = []
  let inQuotes = false
  let field = ''

  for (let i = 0; i < content.length; i++) {
    const char = content[i]
    const nextChar = content[i + 1]

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        field += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      row.push(field)
      field = ''
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++
      row.push(field)
      field = ''
      if (row.length > 1) lines.push(row)
      row = []
    } else {
      field += char
    }
  }
  if (row.length > 1 || field) {
    row.push(field)
    lines.push(row)
  }
  return lines
}

const SEV_MAP = {
  blocker: 'Critical',
  critical: 'Critical',
  major: 'High',
  normal: 'Medium',
  minor: 'Low',
  trivial: 'Low',
}

// 48 bug IDs from the original evaluation dataset to strictly exclude
const EXCLUDED_IDS = new Set([
  '379612', '532493', '580187', '557060',
  '508456', '399843', '373589', '132020',
  '330367', '323763', '767775', '652427',
  '465606', '328128', '504450', '526446',
  '243346', '403907', '452734', '225404',
  '453801', '196328', '430948', '495558',
  '783525', '580892', '626741', '365329',
  '376911', '198957', '335496', '462441',
  '818436', '772679', '621363', '603919',
  '474157', '599289', '523057', '297387',
  '203959', '437856', '255952', '625920',
  '562452', '394085', '519676', '297762',
])

export function buildDatasets() {
  const csvPath = path.join(process.cwd(), 'scripts', 'bugzilla_eclipse_raw.csv')
  const csvContent = fs.readFileSync(csvPath, 'utf-8')
  const rows = parseCSV(csvContent)

  // Component groups within the Bugzilla dataset family
  const eclipseComponents = new Set(['Platform', 'JDT', 'CDT'])
  const mozillaComponents = new Set(['Firefox', 'Thunderbird', 'Core', 'Bugzilla'])

  const eclipsePool = { Critical: [], High: [], Medium: [], Low: [] }
  const mozillaPool = { Critical: [], High: [], Medium: [], Low: [] }

  for (let i = 1; i < rows.length; i++) {
    const [project, bugId, rawSeverity, status, desc] = rows[i]
    if (!desc || !bugId || EXCLUDED_IDS.has(bugId)) continue

    const words = desc.trim().split(/\s+/).filter((w) => w.length > 0)
    // STRICT length filter: ALL bugs across all splits must have >= 15 words
    if (words.length < 15) continue

    const mappedSev = SEV_MAP[rawSeverity?.toLowerCase()]
    if (!mappedSev) continue

    const isEclipse = eclipseComponents.has(project)
    const record = {
      sourceBugId: bugId.trim(),
      component_group: isEclipse ? 'eclipse' : 'mozilla',
      component: project.trim(),
      rawSeverity: rawSeverity.trim().toLowerCase(),
      title: `[${project.trim()}] Bug #${bugId.trim()}: ${desc.trim()}`,
      description: desc.trim(),
      expectedSeverity: mappedSev,
      wordCount: words.length,
    }

    if (isEclipse) {
      eclipsePool[mappedSev].push(record)
    } else if (mozillaComponents.has(project)) {
      mozillaPool[mappedSev].push(record)
    }
  }

  const rng = createRng(42)

  // Shuffle all pool buckets deterministically
  const shuffledEclipse = {
    Critical: shuffle(eclipsePool.Critical, rng),
    High: shuffle(eclipsePool.High, rng),
    Medium: shuffle(eclipsePool.Medium, rng),
    Low: shuffle(eclipsePool.Low, rng),
  }

  const shuffledMozilla = {
    Critical: shuffle(mozillaPool.Critical, rng),
    High: shuffle(mozillaPool.High, rng),
    Medium: shuffle(mozillaPool.Medium, rng),
    Low: shuffle(mozillaPool.Low, rng),
  }

  // ==========================================
  // 1. DEV SETS (Tuning only, balanced)
  // Eclipse: 12 per class = 48 bugs
  // Mozilla: 25 per class = 100 bugs
  // ==========================================
  const eclipseDev = [
    ...shuffledEclipse.Critical.slice(0, 12),
    ...shuffledEclipse.High.slice(0, 12),
    ...shuffledEclipse.Medium.slice(0, 12),
    ...shuffledEclipse.Low.slice(0, 12),
  ]

  const mozillaDev = [
    ...shuffledMozilla.Critical.slice(0, 25),
    ...shuffledMozilla.High.slice(0, 25),
    ...shuffledMozilla.Medium.slice(0, 25),
    ...shuffledMozilla.Low.slice(0, 25),
  ]

  // ==========================================
  // 2. TRACK A: BALANCED HELD-OUT SETS
  // Eclipse: 12 per class = 48 bugs (slices 12..24)
  // Mozilla: 25 per class = 100 bugs (slices 25..50)
  // ==========================================
  const eclipseHeldoutBalanced = [
    ...shuffledEclipse.Critical.slice(12, 24),
    ...shuffledEclipse.High.slice(12, 24),
    ...shuffledEclipse.Medium.slice(12, 24),
    ...shuffledEclipse.Low.slice(12, 24),
  ]

  const mozillaHeldoutBalanced = [
    ...shuffledMozilla.Critical.slice(25, 50),
    ...shuffledMozilla.High.slice(25, 50),
    ...shuffledMozilla.Medium.slice(25, 50),
    ...shuffledMozilla.Low.slice(25, 50),
  ]

  // ==========================================
  // 3. TRACK B: NATURAL-IMBALANCE POOLED HELD-OUT SET
  // Targets: ~5% Critical, ~15% High, ~50% Medium, ~30% Low
  // Critical: All 9 remaining Eclipse Critical (33 - 24 = 9) + 10 Mozilla Critical (slices 50..60) = 19 Critical (5.0%)
  // High: 24 Eclipse (slices 24..48) + 33 Mozilla (slices 50..83) = 57 High (15.0%)
  // Medium: 95 Eclipse (slices 24..119) + 95 Mozilla (slices 50..145) = 190 Medium (50.0%)
  // Low: 35 Eclipse (all remaining 59-24=35, slices 24..59) + 79 Mozilla (slices 50..129) = 114 Low (30.0%)
  // Total Pooled = 19 + 57 + 190 + 114 = 380 bugs (Exact 5.0% / 15.0% / 50.0% / 30.0% breakdown)
  // ==========================================
  const heldoutNaturalPooled = [
    // Critical (19 total = 9 Eclipse + 10 Mozilla)
    ...shuffledEclipse.Critical.slice(24, 33),
    ...shuffledMozilla.Critical.slice(50, 60),

    // High (57 total = 24 Eclipse + 33 Mozilla)
    ...shuffledEclipse.High.slice(24, 48),
    ...shuffledMozilla.High.slice(50, 83),

    // Medium (190 total = 95 Eclipse + 95 Mozilla)
    ...shuffledEclipse.Medium.slice(24, 119),
    ...shuffledMozilla.Medium.slice(50, 145),

    // Low (114 total = 35 Eclipse + 79 Mozilla)
    ...shuffledEclipse.Low.slice(24, 59),
    ...shuffledMozilla.Low.slice(50, 129),
  ]

  // Assign distinct IDs
  const addIds = (list, prefix) =>
    list.map((item, idx) => ({
      id: `${prefix}-${(idx + 1).toString().padStart(3, '0')}`,
      ...item,
    }))

  const finalEclipseDev = addIds(shuffle(eclipseDev, rng), 'e-dev')
  const finalMozillaDev = addIds(shuffle(mozillaDev, rng), 'm-dev')
  const finalEclipseHeldoutBalanced = addIds(shuffle(eclipseHeldoutBalanced, rng), 'e-held-bal')
  const finalMozillaHeldoutBalanced = addIds(shuffle(mozillaHeldoutBalanced, rng), 'm-held-bal')
  const finalHeldoutNaturalPooled = addIds(shuffle(heldoutNaturalPooled, rng), 'held-nat-pool')

  // Clean up any obsolete natural split files if they exist
  const legacyFiles = ['eclipse-heldout-natural.json', 'mozilla-heldout-natural.json', 'eclipse-heldout.json', 'mozilla-heldout.json']
  for (const f of legacyFiles) {
    const fullPath = path.join(process.cwd(), 'scripts', f)
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath)
    }
  }

  // STRICT ASSERTIONS & DISJOINTNESS ENFORCEMENT ACROSS ALL 5 FILES
  const allIds = new Set()
  const allSourceIds = new Set()
  const allDatasets = [
    { name: 'eclipse-dev.json', data: finalEclipseDev },
    { name: 'mozilla-dev.json', data: finalMozillaDev },
    { name: 'eclipse-heldout-balanced.json', data: finalEclipseHeldoutBalanced },
    { name: 'mozilla-heldout-balanced.json', data: finalMozillaHeldoutBalanced },
    { name: 'heldout-natural-pooled.json', data: finalHeldoutNaturalPooled },
  ]

  for (const ds of allDatasets) {
    for (const b of ds.data) {
      if (b.wordCount < 15) {
        throw new Error(`Length filter violation: Bug ${b.id} (${b.sourceBugId}) has only ${b.wordCount} words (<15)!`)
      }
      if (allIds.has(b.id)) {
        throw new Error(`Duplicate id: ${b.id}`)
      }
      if (allSourceIds.has(b.sourceBugId)) {
        throw new Error(`Overlap violation: Bug source ID ${b.sourceBugId} appears in multiple files!`)
      }
      if (EXCLUDED_IDS.has(b.sourceBugId)) {
        throw new Error(`Legacy leak violation: Bug source ID ${b.sourceBugId} was in the original 48 benchmark bugs!`)
      }
      allIds.add(b.id)
      allSourceIds.add(b.sourceBugId)
    }
  }

  // Write all 5 active files to disk
  for (const ds of allDatasets) {
    fs.writeFileSync(path.join(process.cwd(), 'scripts', ds.name), JSON.stringify(ds.data, null, 2))
  }

  return {
    pools: {
      eclipse: {
        Critical: eclipsePool.Critical.length,
        High: eclipsePool.High.length,
        Medium: eclipsePool.Medium.length,
        Low: eclipsePool.Low.length,
      },
      mozilla: {
        Critical: mozillaPool.Critical.length,
        High: mozillaPool.High.length,
        Medium: mozillaPool.Medium.length,
        Low: mozillaPool.Low.length,
      },
    },
    datasets: allDatasets,
  }
}

const isMain = process.argv[1] && process.argv[1].endsWith('build-datasets.mjs')
if (isMain) {
  const result = buildDatasets()

  const summarize = (name, list) => {
    const counts = { Critical: 0, High: 0, Medium: 0, Low: 0 }
    let totalWords = 0
    let minWords = Infinity
    list.forEach((b) => {
      counts[b.expectedSeverity]++
      totalWords += b.wordCount
      if (b.wordCount < minWords) minWords = b.wordCount
    })
    const total = list.length
    return {
      name,
      total,
      Critical: `${counts.Critical} (${((counts.Critical / total) * 100).toFixed(1)}%)`,
      High: `${counts.High} (${((counts.High / total) * 100).toFixed(1)}%)`,
      Medium: `${counts.Medium} (${((counts.Medium / total) * 100).toFixed(1)}%)`,
      Low: `${counts.Low} (${((counts.Low / total) * 100).toFixed(1)}%)`,
      avgWords: (totalWords / total).toFixed(1),
      minWords,
    }
  }

  console.log('========================================================================================')
  console.log('=== DUAL-TRACK DATASET GENERATION COMPLETED (ALL DESCRIPTIONS >= 15 WORDS) ===')
  console.log('========================================================================================\n')

  console.log('Total Available Eligible Pool (>= 15 words, disjoint from original 48):')
  console.log('  Eclipse-family (Platform, JDT, CDT):', result.pools.eclipse)
  console.log('  Mozilla-family (Firefox, Core, Thunderbird, Bugzilla):', result.pools.mozilla)
  console.log('\nGenerated Splits Summary (5 Files Total):\n')

  const summaryRows = result.datasets.map((ds) => summarize(ds.name, ds.data))
  console.table(summaryRows)
}
