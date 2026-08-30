// correlation.js — the "dynamic tolerance engine".
//
// Honest framing: with realistic amounts of personal logging data, this can surface
// *candidate* trigger ingredients worth paying attention to — it cannot prove causation.
// Composite meals mean a flare gets attributed to every ingredient present that day,
// so scores are most meaningful once an ingredient has been eaten several times in
// different combinations. We surface a confidence tier alongside every score, and flag
// when a linked flare coincides with high stress or poor sleep, since those are common
// confounders in IBD symptom flares.

const WINDOW_MIN_H = 12;
const WINDOW_MAX_H = 48;
const MIN_EXPOSURES_FOR_SCORE = 3;

const HOUR_MS = 60 * 60 * 1000;

function dateKey(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

/**
 * @param meals array of {id, timestamp, items:[{fdcId, description, grams}]}
 * @param symptoms array of {id, timestamp, severity(0-10)}
 * @param checkins array of {date, stress(1-5), sleepQuality(1-5)}
 * @returns array of ingredient risk records, sorted by risk desc
 */
export function computeTriggerScores(meals, symptoms, checkins) {
  const checkinByDate = new Map(checkins.map((c) => [c.date, c]));
  const ingredientStats = new Map(); // key: fdcId -> stats

  for (const meal of meals) {
    const windowStart = meal.timestamp + WINDOW_MIN_H * HOUR_MS;
    const windowEnd = meal.timestamp + WINDOW_MAX_H * HOUR_MS;

    const symptomsInWindow = symptoms.filter(
      (s) => s.timestamp >= windowStart && s.timestamp <= windowEnd
    );
    const hadSymptom = symptomsInWindow.length > 0;
    const maxSeverity = hadSymptom ? Math.max(...symptomsInWindow.map((s) => s.severity || 0)) : 0;

    // Confounder check: was stress/sleep notably bad on the day(s) symptoms occurred?
    let confounded = false;
    if (hadSymptom) {
      for (const s of symptomsInWindow) {
        const c = checkinByDate.get(dateKey(s.timestamp));
        if (c && ((c.stress ?? 0) >= 4 || (c.sleepQuality ?? 5) <= 2)) {
          confounded = true;
          break;
        }
      }
    }

    for (const item of meal.items || []) {
      const key = item.fdcId;
      if (!ingredientStats.has(key)) {
        ingredientStats.set(key, {
          fdcId: key,
          description: item.description,
          exposures: 0,
          flares: 0,
          confoundedFlares: 0,
          severitySum: 0,
        });
      }
      const stat = ingredientStats.get(key);
      stat.exposures += 1;
      if (hadSymptom) {
        stat.flares += 1;
        stat.severitySum += maxSeverity;
        if (confounded) stat.confoundedFlares += 1;
      }
    }
  }

  const results = [];
  for (const stat of ingredientStats.values()) {
    const hasEnoughData = stat.exposures >= MIN_EXPOSURES_FOR_SCORE;
    const riskScore = stat.exposures > 0 ? stat.flares / stat.exposures : 0;
    const avgSeverity = stat.flares > 0 ? stat.severitySum / stat.flares : 0;
    const confoundedShare = stat.flares > 0 ? stat.confoundedFlares / stat.flares : 0;

    let confidence = 'low';
    if (stat.exposures >= 8) confidence = 'high';
    else if (stat.exposures >= 5) confidence = 'medium';

    results.push({
      fdcId: stat.fdcId,
      description: stat.description,
      exposures: stat.exposures,
      flares: stat.flares,
      riskScore,
      avgSeverity,
      confidence: hasEnoughData ? confidence : 'insufficient-data',
      confoundedShare,
      note: !hasEnoughData
        ? `Only ${stat.exposures} exposure(s) logged — need ${MIN_EXPOSURES_FOR_SCORE}+ before this is meaningful.`
        : confoundedShare >= 0.5
        ? 'Half or more of the linked flares coincided with high stress or poor sleep — treat this score with extra caution.'
        : null,
    });
  }

  return results.sort((a, b) => b.riskScore - a.riskScore || b.exposures - a.exposures);
}

/** Safety label for display, replacing static grading with empirical personal data. */
export function safetyLabel(record) {
  if (record.confidence === 'insufficient-data') return { label: 'Not enough data', tone: 'neutral' };
  if (record.riskScore === 0) return { label: 'Well tolerated so far', tone: 'good' };
  if (record.riskScore < 0.34) return { label: 'Occasionally linked to symptoms', tone: 'caution' };
  if (record.riskScore < 0.67) return { label: 'Often linked to symptoms', tone: 'warn' };
  return { label: 'Frequently linked to symptoms', tone: 'danger' };
}
