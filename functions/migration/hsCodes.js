/**
 * HS tariff codes - the customs commodity stage.
 *
 * Climax has two commodity tables, and a clearing job is wired to the one the
 * `commodities` stage does NOT import:
 *
 *   Gen_Commodity     the general commodity master. Log_Job has no CommodityId
 *                     column at all, so no clearing job references it.
 *   Gen_UnCommodity   HsCode + HsDescription, 6,607 rows. The customs TARIFF
 *                     master, and the table Log_Job.HSCCode is a declared
 *                     foreign key onto.
 *
 * Not one of CargoLinkers' 15,364 jobs populates HSCCode, so nothing
 * historical points here. It is imported anyway: an HS code is what a goods
 * declaration is built on, and the agent needs the tariff list to classify
 * goods on a NEW declaration.
 *
 * Lands in the same Commodity table as the general list - the picker is one
 * list - but keyed on the HS code rather than a legacy id, because
 * Gen_UnCommodity has no Id column.
 */

import axiosClient from 'apis/axiosClient';

const LEGACY_API =
  process.env.NEXT_PUBLIC_CLIMAX_LEGACY_URL || 'http://localhost:8081';

async function fetchHsCodes() {
  try {
    const { data } = await axiosClient.get(`${LEGACY_API}/jobs/getLogCommodities`);
    if (!Array.isArray(data?.Commodities)) {
      throw new Error(
        `${LEGACY_API}/jobs/getLogCommodities responded but returned no Commodities array. `
        + `Got: ${Object.keys(data || {}).join(', ') || '(nothing)'}`
      );
    }
    return data.Commodities;
  } catch (err) {
    if (err?.response?.status === 404) {
      throw new Error(
        `${LEGACY_API}/jobs/getLogCommodities does not exist on this legacy server. It reads `
        + 'Gen_UnCommodity, the HS tariff master. NOTE the customs migration reads the '
        + 'CargoLinkers database (Climax-backup-server-CC), which is a different server from '
        + 'the freight one.'
      );
    }
    if (!err?.response) {
      throw new Error(
        `Could not reach the legacy server at ${LEGACY_API}. Check it is running and that `
        + 'NEXT_PUBLIC_CLIMAX_LEGACY_URL points at it.'
      );
    }
    throw err;
  }
}

export async function migrateHsCodes(report = () => {}, { apply = true } = {}) {
  report('HS tariff codes: fetching from the legacy system...');
  const commodities = await fetchHsCodes();

  if (!commodities.length) {
    report('HS tariff codes: the legacy tariff master is empty.');
    return {
      planned: null, applied: null, verification: null,
      noop: true, reason: 'No tariff codes in the source.',
    };
  }

  report(`HS tariff codes: planning ${commodities.length.toLocaleString()}...`);
  const planRes = await axiosClient.post('/commodity/migration/hs/plan', { commodities });
  const plan = planRes.data.result;

  if (plan.problems.duplicateCodeCount) {
    report(
      `HS tariff codes: ${plan.problems.duplicateCodeCount} duplicate code(s) in the source `
      + 'were collapsed to one. Codes are matched ignoring dots and spaces, so "0101.20" and '
      + '"010120" count as the same tariff line.'
    );
  }
  if (plan.stats.withoutDescription) {
    report(
      `HS tariff codes: ${plan.stats.withoutDescription} code(s) have no description and will `
      + 'show as the bare code in the commodity picker.'
    );
  }

  if (!apply) {
    report(`HS tariff codes: ${plan.stats.toCreate.toLocaleString()} would be created (dry run).`);
    return { planned: plan, applied: null, verification: null, noop: true, reason: 'Dry run.' };
  }

  if (plan.stats.toCreate === 0) {
    report('HS tariff codes: already imported, nothing to do.');
  } else {
    report(`HS tariff codes: importing ${plan.stats.toCreate.toLocaleString()}...`);
    const applyRes = await axiosClient.post('/commodity/migration/hs/apply', { commodities });
    plan.applied = applyRes.data.result;
    report(`HS tariff codes: created ${plan.applied.created.toLocaleString()}.`);
  }

  report('HS tariff codes: verifying...');
  const verifyRes = await axiosClient.get('/commodity/migration/hs/verify');
  const verification = verifyRes.data.result;

  report(
    `HS tariff codes: ${verification.commodities.toLocaleString()} commodities in the system - `
    + `${verification.withHsCode.toLocaleString()} carry an HS code.`
  );

  if (verification.duplicateHsCodes) {
    report(
      `HS tariff codes: WARNING - ${verification.duplicateHsCodes} HS code(s) appear more than `
      + 'once. Two commodities sharing a tariff code are indistinguishable in a picker.'
    );
  }

  return {
    planned: plan,
    applied: plan.applied || null,
    verification,
    noop: plan.stats.toCreate === 0,
    reason: plan.stats.toCreate === 0 ? 'Every tariff code was already imported.' : null,
  };
}

/** Plan only - writes nothing. */
export const planHsCodesOnly = (report) => migrateHsCodes(report, { apply: false });
