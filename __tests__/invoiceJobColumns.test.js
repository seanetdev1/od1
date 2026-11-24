/**
 * The job columns of an invoice-driven report - functions/invoiceJobColumns.
 *
 * Job Balancing reads its job columns off Invoice.SE_Job, which only a freight
 * invoice has. Under aviation and customs the server attaches an `aviation` or
 * `customs` block instead, and the report ignored both - so every job column
 * except Job No came out blank.
 *
 * What is worth pinning is the part a reader of the report cannot check: that
 * the freight mapping did not move, that each mode's fields land in the column
 * they were meant for, and that a column with no meaning in a mode stays
 * EMPTY rather than being filled with something that looks plausible.
 */
import {
  jobColumns, jobKindOf, jobLink, docHeadings,
  usesColumn, filledColumns, ALL_JOB_COLUMNS,
} from 'functions/invoiceJobColumns';

const freightInvoice = {
  SE_Job: {
    id: 7, jobNo: 'SNS-SE-1/26', operation: 'SE', subType: 'FCL',
    createdAt: '2026-07-01', shipDate: '2026-07-02', arrivalDate: '2026-07-20',
    fd: 'JED', weight: '1200', vol: '3.5', customerRef: 'REF1',
    freightType: 'Prepaid',
    Bl: { hbl: 'HBL1', mbl: 'MBL1' },
    Client: { code: 'C1' },
    shipper: { name: 'Shipper Co' },
    consignee: { name: 'Consignee Co' },
    sales_representator: { name: 'Rep' },
    shipping_line: { name: 'Line' },
    vessel: { name: 'MV Ship' },
    SE_Equipments: [{ size: '40HC' }, { size: '20GP' }],
    Delivery_Order: { date: '2026-07-22' },
  },
  aviation: null,
  customs: null,
};

const aviationInvoice = {
  SE_Job: null,
  customs: null,
  aviation: {
    jobId: 21, jobNo: 'GEN-AVJ-9/26', flightNo: 'PK-301',
    flightDate: '2026-07-15', sector: 'KHI - JED',
    awbs: ['214-12345678', '214-87654321'],
  },
};

const customsInvoice = {
  SE_Job: null,
  aviation: null,
  // A bill's - the vendor's own tax invoice, entered on its page.
  vendorTaxInvoiceNo: 'STI-4471',
  customs: {
    jobId: 33, jobNo: 'CLS-CC-4/26', jobDate: '2026-07-08', gdNumber: 'KAPE-1234',
    gdDate: '2026-07-10', blNo: 'BL-9', direction: 'Import',
    transportMode: 'Sea', clientInvoiceNo: 'AMA-18792-26',
  },
};

describe('which kind of job an invoice is against', () => {
  test('names exactly one, or none', () => {
    expect(jobKindOf(freightInvoice)).toBe('freight');
    expect(jobKindOf(aviationInvoice)).toBe('aviation');
    expect(jobKindOf(customsInvoice)).toBe('customs');
    expect(jobKindOf({ SE_Job: null, aviation: null, customs: null })).toBe('none');
    expect(jobKindOf(undefined)).toBe('none');
  });
});

describe('a freight row', () => {
  test('maps exactly what the report always read', () => {
    // The whole freight path must not move: this install is the one already
    // in production, and a "fix" for two other modes that shifts a freight
    // column is a regression nobody asked for.
    const c = jobColumns(freightInvoice);
    expect(c).toMatchObject({
      kind: 'freight',
      jobNo: 'SNS-SE-1/26',
      docPrimary: 'HBL1',
      docSecondary: 'MBL1',
      sailDate: '2026-07-02',
      arrivalDate: '2026-07-20',
      finalDestination: 'JED',
      jobType: 'FCL',
      vessel: 'MV Ship',
      shippingLine: 'Line',
      shipper: 'Shipper Co',
      consignee: 'Consignee Co',
      salesRep: 'Rep',
      clientCode: 'C1',
      weight: '1200',
      volume: '3.5',
      containers: '40HC, 20GP',
    });
  });

  test('carries the delivery order date', () => {
    expect(jobColumns(freightInvoice).doDate).toBe('2026-07-22');
    expect(jobColumns({ SE_Job: { ...freightInvoice.SE_Job, Delivery_Order: null } }).doDate).toBe('');
  });

  test('calls an air job Air, not the LCL its subType carries', () => {
    // Climax printed "Air". Every migrated air job holds the sea form's LCL
    // default in subType, so reading subType called air shipments LCL.
    for (const operation of ['AE', 'AI']) {
      expect(jobColumns({ SE_Job: { ...freightInvoice.SE_Job, operation, subType: 'LCL' } }).jobType).toBe('Air');
    }
    expect(jobColumns({ SE_Job: { ...freightInvoice.SE_Job, operation: 'SI', subType: 'LCL' } }).jobType).toBe('LCL');
  });

  test('an invoice against no job at all is empty, not a crash', () => {
    const c = jobColumns({ SE_Job: null, aviation: null, customs: null });
    expect(c.kind).toBe('none');
    expect(c.jobNo).toBe('');
    expect(c.containers).toBe('');
    expect(jobColumns(undefined).jobNo).toBe('');
  });
});

describe('an aviation row', () => {
  test('puts every billed AWB in the first document column', () => {
    // An invoice can cover several AWBs, and a flight has no house/master
    // pair - so they go in one column rather than being split across two as
    // though they were one shipment's documents.
    const c = jobColumns(aviationInvoice);
    expect(c.docPrimary).toBe('214-12345678, 214-87654321');
    expect(c.docSecondary).toBe('PK-301');
  });

  test('carries the flight, its date and its sector', () => {
    const c = jobColumns(aviationInvoice);
    expect(c.jobNo).toBe('GEN-AVJ-9/26');
    expect(c.jobDate).toBe('2026-07-15');
    expect(c.finalDestination).toBe('KHI - JED');
    expect(c.jobType).toBe('AV');
  });

  test('leaves the columns a flight has no answer for empty', () => {
    // Not filled with the flight number three times over to look complete.
    const c = jobColumns(aviationInvoice);
    for (const k of ['vessel', 'shippingLine', 'shipper', 'consignee',
      'salesRep', 'arrivalDate', 'sailDate', 'containers', 'weight', 'volume']) {
      expect(c[k]).toBe('');
    }
  });

  test('survives a flight with no AWBs recorded', () => {
    const c = jobColumns({ aviation: { jobId: 1, jobNo: 'X', awbs: [] } });
    expect(c.docPrimary).toBe('');
  });
});

describe('a customs row', () => {
  test('puts the BL and the GD in the two document columns', () => {
    const c = jobColumns(customsInvoice);
    expect(c.docPrimary).toBe('BL-9');
    expect(c.docSecondary).toBe('KAPE-1234');
  });

  test('the job date, and the GD date and client invoice in columns of their own', () => {
    const c = jobColumns(customsInvoice);
    expect([c.jobDate, c.gdDate, c.clientInvoiceNo]).toEqual(['2026-07-08', '2026-07-10', 'AMA-18792-26']);
    // A job with no date of its own shows its GD date there, as it always did.
    expect(jobColumns({ customs: { gdDate: '2026-07-10' } }).jobDate).toBe('2026-07-10');
  });

  test('reports the direction as the job type', () => {
    // Import/Export is the split a clearing agent works in, and the one that
    // decides which pair of accounts the job posts to.
    expect(jobColumns(customsInvoice).jobType).toBe('Import');
    expect(jobColumns({ customs: { direction: 'Export' } }).jobType).toBe('Export');
  });

  test('shows the transport mode where a freight row shows a vessel', () => {
    expect(jobColumns(customsInvoice).vessel).toBe('Sea');
  });

  test('leaves the columns a clearance has no answer for empty', () => {
    const c = jobColumns(customsInvoice);
    for (const k of ['finalDestination', 'shippingLine', 'shipper',
      'consignee', 'salesRep', 'arrivalDate', 'containers']) {
      expect(c[k]).toBe('');
    }
  });
});

describe('every mode returns the same shape', () => {
  test('so the table, the CSV and the Excel export cannot disagree', () => {
    const keys = (o) => Object.keys(o).sort();
    const freight = keys(jobColumns(freightInvoice));
    expect(keys(jobColumns(aviationInvoice))).toEqual(freight);
    expect(keys(jobColumns(customsInvoice))).toEqual(freight);
    expect(keys(jobColumns(undefined))).toEqual(freight);
  });

  test('and never yields undefined into an export cell', () => {
    for (const inv of [freightInvoice, aviationInvoice, customsInvoice, undefined, {}]) {
      for (const [k, v] of Object.entries(jobColumns(inv))) {
        if (k === 'jobId' || k === 'kind') continue;
        expect(typeof v).toBe('string');
      }
    }
  });
});

describe('the document column headings', () => {
  test('name the document that mode actually puts there', () => {
    expect(docHeadings('freight')).toEqual({ primary: 'HBL/HAWB', secondary: 'MBL/MAWB' });
    expect(docHeadings('aviation')).toEqual({ primary: 'AWB(s)', secondary: 'Flight No.' });
    expect(docHeadings('customs')).toEqual({ primary: 'BL No', secondary: 'GD No' });
  });

  test('fall back to the freight wording for an unknown mode', () => {
    expect(docHeadings(undefined).primary).toBe('HBL/HAWB');
    expect(docHeadings('nonsense').primary).toBe('HBL/HAWB');
  });
});

describe('clicking the job number', () => {
  test('opens the flight for an aviation row', () => {
    expect(jobLink(aviationInvoice)).toEqual({
      href: '/aviationJobs/21',
      tab: { label: 'GEN-AVJ-9/26', key: '10-2', id: '21' },
    });
  });

  test('opens the declaration for a customs row', () => {
    expect(jobLink(customsInvoice).href).toBe('/customsJobs/33');
  });

  test('routes a freight row by its operation, as before', () => {
    expect(jobLink(freightInvoice).href).toBe('/seaJobs/export/7');
    expect(jobLink({ SE_Job: { ...freightInvoice.SE_Job, operation: 'AI' } }).href)
      .toBe('/airJobs/import/7');
  });

  test('offers nothing for an invoice against no job', () => {
    expect(jobLink({ SE_Job: null, aviation: null, customs: null })).toBeNull();
    expect(jobLink(undefined)).toBeNull();
  });
});

describe('which columns a mode shows at all', () => {
  /* THE POLICY HAS TO MATCH THE MAPPING.
   *
   * The report drops a column its mode never fills. If the two lists drift,
   * one of two things happens and neither is visible on screen: a column with
   * real data in it is hidden, or a blank one is left there. Both are checked
   * against a FULLY POPULATED invoice of each kind, so a column that is empty
   * here is empty because the mode has no such concept - not because the
   * fixture forgot it. */
  const sample = {
    freight: freightInvoice,
    aviation: aviationInvoice,
    customs: customsInvoice,
  };

  test.each(['freight', 'aviation', 'customs'])('%s hides exactly the columns it cannot fill', (mode) => {
    const cols = jobColumns(sample[mode]);
    for (const key of ALL_JOB_COLUMNS) {
      if (usesColumn(mode, key)) {
        expect(`${mode}.${key}=${cols[key]}`).not.toBe(`${mode}.${key}=`);
      } else {
        expect(`${mode}.${key}=${cols[key]}`).toBe(`${mode}.${key}=`);
      }
    }
  });

  test('freight keeps every column it always had - and not the customs ones', () => {
    expect(filledColumns('freight')).toEqual(ALL_JOB_COLUMNS.filter((k) => !['gdDate', 'clientInvoiceNo', 'vendorTaxInvoiceNo'].includes(k)));
    expect(usesColumn('aviation', 'gdDate')).toBe(false);
    expect(usesColumn('customs', 'gdDate')).toBe(true);
    expect(usesColumn('customs', 'clientInvoiceNo')).toBe(true);
    // Job Balancing on customs (the user's request, 2026-10-09).
    expect(usesColumn('customs', 'vendorTaxInvoiceNo')).toBe(true);
    expect(jobColumns(customsInvoice).vendorTaxInvoiceNo).toBe('STI-4471');
  });

  test('aviation drops the ones a flight has no answer for', () => {
    for (const k of ['sailDate', 'arrivalDate', 'vessel', 'shippingLine', 'shipper',
      'consignee', 'salesRep', 'clientCode', 'weight', 'volume', 'containers', 'freightType']) {
      expect(usesColumn('aviation', k)).toBe(false);
    }
    // But keeps the sector, which is the one a flight does answer.
    expect(usesColumn('aviation', 'finalDestination')).toBe(true);
  });

  test('customs drops the sector but keeps the transport mode', () => {
    expect(usesColumn('customs', 'finalDestination')).toBe(false);
    expect(usesColumn('customs', 'vessel')).toBe(true);
  });

  test('an unknown mode shows what freight does', () => {
    expect(filledColumns('nonsense')).toEqual(filledColumns('freight'));
    expect(usesColumn(undefined, 'shipper')).toBe(true);
  });
});
