import fs from 'fs';
import path from 'path';
import { runEvaluation } from './run-evaluation.mjs';

const SEVERITY_LEVELS = ['Critical', 'High', 'Medium', 'Low'];

function getSeverityIndex(sev) {
  return SEVERITY_LEVELS.indexOf(sev);
}

function isAdjacent(sev1, sev2) {
  const i1 = getSeverityIndex(sev1);
  const i2 = getSeverityIndex(sev2);
  if (i1 === -1 || i2 === -1) return false;
  return Math.abs(i1 - i2) <= 1;
}

function calculateMeanAndStdDev(numbers) {
  if (numbers.length === 0) return { mean: 0, stdDev: 0 };
  const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length;
  const variance = numbers.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / numbers.length;
  return { mean, stdDev: Math.sqrt(variance) };
}

async function runEvalLoop() {
  const NUM_RUNS = 5;
  const runs = [];
  
  console.log(`===============================================================`);
  console.log(`--- AI ORCHESTRATOR STABILITY HARNESS (${NUM_RUNS} RUNS) ---`);
  console.log(`===============================================================\n`);

  for (let i = 1; i <= NUM_RUNS; i++) {
    console.log(`\n\n>>> STARTING RUN ${i} OF ${NUM_RUNS} <<<\n`);
    const runResult = await runEvaluation();
    
    // Calculate adjacent accuracy for this run
    let adjacentCorrect = 0;
    const classificationBugs = runResult.sampleRecords.filter(r => !r.isAmbiguous);
    
    for (const r of classificationBugs) {
      if (isAdjacent(r.expectedSeverity, r.actualSeverity)) {
        adjacentCorrect++;
      }
    }
    
    const adjacentAccuracy = (adjacentCorrect / classificationBugs.length) * 100;
    
    runs.push({
      runNumber: i,
      accuracyPercentage: runResult.accuracyPercentage,
      adjacentAccuracyPercentage: Number(adjacentAccuracy.toFixed(2)),
      confusionMatrix: runResult.confusionMatrix,
      sampleRecords: runResult.sampleRecords
    });
  }

  // Aggregate stats
  const overallAccuracies = runs.map(r => r.accuracyPercentage);
  const adjacentAccuracies = runs.map(r => r.adjacentAccuracyPercentage);
  
  const overallStats = calculateMeanAndStdDev(overallAccuracies);
  const adjacentStats = calculateMeanAndStdDev(adjacentAccuracies);
  
  // Stability check
  // Which specific bugs got a DIFFERENT severity assigned in at least one of the 5 runs
  const bugSeverities = {};
  
  for (const run of runs) {
    for (const record of run.sampleRecords) {
      if (!record.isAmbiguous) {
        if (!bugSeverities[record.id]) {
          bugSeverities[record.id] = { title: record.title, severities: [] };
        }
        bugSeverities[record.id].severities.push(record.actualSeverity);
      }
    }
  }

  const unstableBugs = [];
  let stableCount = 0;
  const totalBugs = Object.keys(bugSeverities).length; // Should be 18

  for (const [id, data] of Object.entries(bugSeverities)) {
    const uniqueSeverities = [...new Set(data.severities)];
    if (uniqueSeverities.length > 1) {
      unstableBugs.push({ id, title: data.title, uniqueSeverities });
    } else {
      stableCount++;
    }
  }

  const stabilityScore = (stableCount / totalBugs) * 100;

  console.log(`\n===============================================================`);
  console.log(`--- LOOP EVALUATION SUMMARY (${NUM_RUNS} RUNS) ---`);
  console.log(`===============================================================`);
  console.log(`Overall Accuracy:  Mean = ${overallStats.mean.toFixed(2)}% | StdDev = ${overallStats.stdDev.toFixed(2)}%`);
  console.log(`Adjacent Accuracy: Mean = ${adjacentStats.mean.toFixed(2)}% | StdDev = ${adjacentStats.stdDev.toFixed(2)}%`);
  console.log(`Stability Score:   ${stabilityScore.toFixed(2)}% (${stableCount}/${totalBugs} bugs perfectly stable)`);
  
  if (unstableBugs.length > 0) {
    console.log(`\nUnstable Bugs (different severity across runs):`);
    for (const b of unstableBugs) {
      console.log(`  - Bug #${b.id}: ${b.title.slice(0, 45)}... (assigned: ${b.uniqueSeverities.join(', ')})`);
    }
  } else {
    console.log(`\nUnstable Bugs: None! 100% stable.`);
  }

  const outputPayload = {
    evaluatedAt: new Date().toISOString(),
    numRuns: NUM_RUNS,
    aggregateStats: {
      overallAccuracy: {
        mean: Number(overallStats.mean.toFixed(2)),
        stdDev: Number(overallStats.stdDev.toFixed(2))
      },
      adjacentAccuracy: {
        mean: Number(adjacentStats.mean.toFixed(2)),
        stdDev: Number(adjacentStats.stdDev.toFixed(2))
      },
      stabilityScore: Number(stabilityScore.toFixed(2)),
      stableCount,
      totalBugs,
      unstableBugs
    },
    runs
  };

  const outputPath = path.join(process.cwd(), 'scripts', 'loop-eval-results.json');
  fs.writeFileSync(outputPath, JSON.stringify(outputPayload, null, 2), 'utf-8');
  console.log(`\n✓ Successfully exported loop evaluation results to: ${outputPath}`);
}

runEvalLoop().catch(err => {
  console.error('Fatal loop evaluation error:', err);
  process.exit(1);
});
