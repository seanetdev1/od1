/**
 * The names of a freight invoice's ports, for its print.
 *
 * From Setup > Ports (or Airports) - the list the job's ports are picked from.
 * The print looked them up in the frontend's built-in list instead, which has
 * about 45,000 ports to Setup's 108,000, so a port only Setup knows printed as
 * its code: SNS-JI-612/27's Sihanoukville came out as "KHSIH".
 *
 * Returned as { code: name } for the job's pol, pod and fd. A code Setup does
 * not have is left out, and the print falls back to the built-in list, then
 * to the code.
 */
async function printPlaceNames({ Ports, Airports }, invoice) {
  // A customs invoice's ports are its declaration's (attachPrintContext puts
  // it on the invoice first) - for an invoice template, which can print them.
  const customs = invoice?.dataValues?.customsJob || invoice?.customsJob;
  const job = invoice?.SE_Job || customs;
  if (!job) return {};
  const places = customs && !invoice?.SE_Job ? [job.pol, job.pod, job.pofd] : [job.pol, job.pod, job.fd];
  const codes = [...new Set(places.filter((c) => c !== null && c !== undefined && c !== '').map(String))];
  if (!codes.length) return {};

  const air = ['AE', 'AI'].includes(invoice.operation)
    || (customs && !invoice?.SE_Job && String(job.transportMode || '').toLowerCase() === 'air');
  const rows = air
    ? await Airports.findAll({ where: { airportCode: codes }, attributes: ['airportCode', 'airportName'] })
    : await Ports.findAll({ where: { portId: codes }, attributes: ['portId', 'portName'], order: [['id', 'ASC']] });

  const names = {};
  for (const r of rows) {
    const code = air ? r.airportCode : r.portId;
    const name = air ? r.airportName : r.portName;
    if (name && !(code in names)) names[code] = name;
  }
  return names;
}

module.exports = { printPlaceNames };
