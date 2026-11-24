// Archive jobs - Climax's LSJobsMaster and what hangs off it.
//
// The lookups follow Climax's own job view (vuLogisticJobInfo): every party
// is a row of LSCommonCodingsSetup, ports are UNLocation, and the mode,
// status and customs stage are fixed numbers decoded below exactly as that
// view decodes them. Written against the tables rather than selecting from
// the view, because the view also sums the security deposits and the latest
// invoice dates over every job in the book - work a single job does not need.

const { query, param } = require('./db');
const { likeContains, day, paging } = require('./inputs');
const { wallDate, wallTime, money } = require('./values');

const MODES = { 1: 'Sea', 2: 'Air', 3: 'Road', 4: 'Train', 5: 'Multi Modal' };
const DIRECTIONS = { 1: 'Import', 2: 'Export' };
const STATUSES = { 1: 'Open', 2: 'Closed', 3: 'Void' };
const PROCESS = { 1: 'In Process', 2: 'Completed' };
const CONTAINER_TYPES = { 1: 'COC', 2: 'SOC', 3: 'LCL' };
// Climax's RecentStatus - the customs stage the file last reached.
const STAGES = {
  1: 'GD prepared', 2: 'Duty Submitted', 3: 'In Examination', 4: 'Under Assessment', 5: 'Document Called',
  6: 'Marked to Appraiser', 7: 'Marked to AC', 8: 'Under Review', 9: 'Detained', 10: 'Assigned to Cashier',
  11: 'Assigned to Gate Out Staff', 12: 'Cleared from Gate Out', 13: 'Delivered',
};

const decode = (table, v) => (v == null ? '' : table[v] || '');

/**
 * Jobs matching a search. `q` looks in the job number, both B/L numbers, the
 * GD number, the client's reference and name, the containers, the file
 * number and the IGM. Newest first.
 */
async function searchJobs(book, query_ = {}) {
  const { page, pageSize, offset } = paging(query_);
  const params = {
    q: param.str(likeContains(query_.q)),
    from: param.date(day(query_.from)),
    to: param.date(day(query_.to)),
    offset: param.int(offset),
    size: param.int(pageSize),
  };
  const fromWhere = `
    FROM LSJobsMaster j
    LEFT JOIN LSCommonCodingsSetup c ON c.CommonCPkId = j.CustomerId
    WHERE (@q IS NULL OR j.JobRefNo LIKE @q OR j.HBLOrAWBNo LIKE @q OR j.MBLOrMAWBNo LIKE @q
           OR j.MachineNo LIKE @q OR j.ClientRefNo LIKE @q OR c.Name LIKE @q OR j.ContainerString LIKE @q
           OR j.CustomFileNo LIKE @q OR j.IGMorEGM LIKE @q)
      AND (@from IS NULL OR j.JobDate >= @from)
      AND (@to IS NULL OR j.JobDate < DATEADD(day, 1, @to))`;
  // Counted apart from the page: a COUNT(*) OVER () on the page query makes
  // SQL Server read and sort every match before it can hand back fifty.
  const [count, rows] = await Promise.all([
    query(book, `SELECT COUNT(*) total ${fromWhere}`, params),
    query(book, `
      SELECT j.JobMasterPKId id, j.JobRefNo jobNo, j.JobDate jobDate, c.Name customer,
             j.ModeId modeId, j.ImportExportId directionId, j.StatusId statusId,
             j.HBLOrAWBNo hbl, j.MBLOrMAWBNo mbl, j.MachineNo gdNo, j.ClientRefNo clientRef,
             j.IGMorEGM igm, j.ContainerString containers, j.NoOfContainers containerCount
      ${fromWhere}
      ORDER BY j.JobDate DESC, j.JobMasterPKId DESC
      OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY`, params),
  ]);
  return {
    page,
    pageSize,
    total: count[0]?.total || 0,
    rows: rows.map((r) => ({
      id: r.id,
      jobNo: r.jobNo,
      jobDate: wallDate(r.jobDate),
      customer: r.customer || '',
      mode: decode(MODES, r.modeId),
      direction: decode(DIRECTIONS, r.directionId),
      status: decode(STATUSES, r.statusId),
      hbl: r.hbl || '',
      mbl: r.mbl || '',
      gdNo: r.gdNo || '',
      clientRef: r.clientRef || '',
      igm: r.igm || '',
      containers: r.containers || '',
      containerCount: r.containerCount || 0,
    })),
  };
}

const HEADER = `
  SELECT j.JobMasterPKId id, j.JobRefNo jobNo, j.JobDate jobDate, j.ProjectRefNo projectRef, j.ClientRefNo clientRef,
         j.ModeId modeId, j.ImportExportId directionId, j.StatusId statusId, j.JobProcessId processId,
         j.RecentStatus stageId, j.ContianerTypeId containerTypeId,
         j.HBLOrAWBNo hbl, j.MBLOrMAWBNo mbl, j.BLDate blDate, j.VoyageOrFlightNo voyage,
         j.ArrivalOrSailingDate arrivalOrSailing, j.IGMorEGM igm, j.IGMDate igmDate, j.IndexNo indexNo,
         j.MachineNo gdNo, j.CashDate gdDate, j.CustomFileNo customFileNo, j.FormENo formENo, j.FormEDate formEDate,
         j.ShippBillNo shippingBillNo, j.ShippBillDate shippingBillDate, j.LC_No lcNo, j.CInvNumber commercialInvoiceNo,
         j.ImptValue importValue, j.VIRNO virNo, j.Pkgs packages, j.Weight weight, j.JGrossWeight grossWeight,
         j.GoodsDescription goodsDescription, j.MarksAndNo marks, j.Remarks remarks,
         j.NoOfContainers containerCount, j.NoOfContainers20 c20, j.NoOfContainers40 c40, j.NoOfContainers45 c45,
         j.NoOfContainersLCL lcl, j.ContainerString containerString, j.ConvoyNo convoyNo,
         j.DODate doDate, j.GPDate gatePassDate, j.DeliveryDate deliveryDate, j.JobCompeletationDate completedDate,
         j.MTReturnDate emptyReturnDate, j.PickupLocationAdd pickupAddress, j.DeliveryLocationAdd deliveryAddress,
         j.FreeDaysAllowed freeDays, j.CreateLog createdBy, j.CreateTim createdOn, j.EditRLog editedBy, j.EditRTim editedOn,
         cust.Name customer, cust.Address1 customerAddress, cust.NTN customerNtn, cust.SalesTaxNo customerStrn,
         cust.AccountId customerAccountId,
         cons.Name consignee, cons.Address1 consigneeAddress, shp.Name shipper, shp.Address1 shipperAddress,
         clr.Name clearingAgent, trn.Name transporter, fwd.Name forwarder, line.Name shippingLine,
         sag.Name shippingAgent, np.Name notifyParty, ter.Name terminal, sp.Name salesPerson, ba.Name borderAgent,
         v.VesselName vessel, pol.locname pol, pod.locname pod, fpod.locname finalDestination,
         jt.JobDescription activity, ct.CargoType cargoType, pu.Description packageType, stg.StageName stageName
  FROM LSJobsMaster j
  LEFT JOIN LSCommonCodingsSetup cust ON cust.CommonCPkId = j.CustomerId
  LEFT JOIN LSCommonCodingsSetup cons ON cons.CommonCPkId = j.ConsigneeId
  LEFT JOIN LSCommonCodingsSetup shp ON shp.CommonCPkId = j.ShipperId
  LEFT JOIN LSCommonCodingsSetup clr ON clr.CommonCPkId = j.ClearingAgentId
  LEFT JOIN LSCommonCodingsSetup trn ON trn.CommonCPkId = j.TransporterId
  LEFT JOIN LSCommonCodingsSetup fwd ON fwd.CommonCPkId = j.ForwarderId
  LEFT JOIN LSCommonCodingsSetup line ON line.CommonCPkId = j.ShippingLineId
  LEFT JOIN LSCommonCodingsSetup sag ON sag.CommonCPkId = j.ShippingAgentId
  LEFT JOIN LSCommonCodingsSetup np ON np.CommonCPkId = j.notifypartyid
  LEFT JOIN LSCommonCodingsSetup ter ON ter.CommonCPkId = j.TerminalId
  LEFT JOIN LSCommonCodingsSetup sp ON sp.CommonCPkId = j.SalesPersonId
  LEFT JOIN LSCommonCodingsSetup ba ON ba.CommonCPkId = j.BorderAgentId
  LEFT JOIN LSVessels v ON v.VesselPkId = j.VesselOrAirLineId
  LEFT JOIN UNLocation pol ON pol.TranID = j.POLId
  LEFT JOIN UNLocation pod ON pod.TranID = j.PODId
  LEFT JOIN UNLocation fpod ON fpod.TranID = j.PODFId
  LEFT JOIN JobType jt ON jt.JobTypeID = j.ActivityId
  LEFT JOIN CargoType ct ON ct.ID = j.CargoTypeID
  LEFT JOIN PackingUnits pu ON pu.PackUnitID = j.PackUnitId
  LEFT JOIN LSStages stg ON stg.StageID = j.RecentStatus`;

function mapHeader(r) {
  return {
    id: r.id,
    jobNo: r.jobNo,
    jobDate: wallDate(r.jobDate),
    projectRef: r.projectRef || '',
    clientRef: r.clientRef || '',
    mode: decode(MODES, r.modeId),
    direction: decode(DIRECTIONS, r.directionId),
    status: decode(STATUSES, r.statusId),
    process: decode(PROCESS, r.processId),
    stage: r.stageName || decode(STAGES, r.stageId),
    containerType: decode(CONTAINER_TYPES, r.containerTypeId),
    activity: r.activity || '',
    cargoType: r.cargoType || '',
    hbl: r.hbl || '',
    mbl: r.mbl || '',
    blDate: wallDate(r.blDate),
    vessel: r.vessel || '',
    voyage: r.voyage || '',
    arrivalOrSailing: wallDate(r.arrivalOrSailing),
    igm: r.igm || '',
    igmDate: wallDate(r.igmDate),
    indexNo: r.indexNo || '',
    gdNo: r.gdNo || '',
    gdDate: wallDate(r.gdDate),
    customFileNo: r.customFileNo || '',
    formENo: r.formENo || '',
    formEDate: wallDate(r.formEDate),
    shippingBillNo: r.shippingBillNo || '',
    shippingBillDate: wallDate(r.shippingBillDate),
    lcNo: r.lcNo || '',
    commercialInvoiceNo: r.commercialInvoiceNo || '',
    importValue: r.importValue == null ? null : Number(r.importValue),
    virNo: r.virNo || '',
    packages: r.packages || '',
    packageType: r.packageType || '',
    weight: r.weight == null ? null : Number(r.weight),
    grossWeight: r.grossWeight == null ? null : Number(r.grossWeight),
    goodsDescription: r.goodsDescription || '',
    marks: r.marks || '',
    remarks: r.remarks || '',
    containerCount: r.containerCount || 0,
    containerMix: { c20: r.c20 || 0, c40: r.c40 || 0, c45: r.c45 || 0, lcl: r.lcl || 0 },
    containerString: r.containerString || '',
    convoyNo: r.convoyNo || '',
    doDate: wallDate(r.doDate),
    gatePassDate: wallDate(r.gatePassDate),
    deliveryDate: wallDate(r.deliveryDate),
    completedDate: wallDate(r.completedDate),
    emptyReturnDate: wallDate(r.emptyReturnDate),
    pickupAddress: r.pickupAddress || '',
    deliveryAddress: r.deliveryAddress || '',
    freeDays: r.freeDays,
    pol: r.pol || '',
    pod: r.pod || '',
    finalDestination: r.finalDestination || '',
    parties: {
      customer: {
        name: r.customer || '',
        address: r.customerAddress || '',
        ntn: r.customerNtn || '',
        strn: r.customerStrn || '',
        // Its ledger account (acctfile.autonumb), for the job's "Ledger" link.
        accountId: r.customerAccountId ? Number(r.customerAccountId) : null,
      },
      consignee: { name: r.consignee || '', address: r.consigneeAddress || '' },
      shipper: { name: r.shipper || '', address: r.shipperAddress || '' },
      clearingAgent: r.clearingAgent || '',
      transporter: r.transporter || '',
      forwarder: r.forwarder || '',
      shippingLine: r.shippingLine || '',
      shippingAgent: r.shippingAgent || '',
      notifyParty: r.notifyParty || '',
      terminal: r.terminal || '',
      salesPerson: r.salesPerson || '',
      borderAgent: r.borderAgent || '',
    },
    created: { by: r.createdBy || '', on: wallTime(r.createdOn) },
    edited: { by: r.editedBy || '', on: wallTime(r.editedOn) },
  };
}

/** The job header alone - what an invoice print needs from its job. */
async function jobHeader(book, id) {
  const rows = await query(book, `${HEADER} WHERE j.JobMasterPKId = @id`, { id: param.int(id) });
  return rows.length ? mapHeader(rows[0]) : null;
}

/** One job with its containers, charges, invoices, bills and their vouchers. */
async function jobDetail(book, id) {
  const header = await jobHeader(book, id);
  if (!header) return null;
  const p = { id: param.int(id) };

  const [containers, receivable, payable, invoices, bills] = await Promise.all([
    query(book, `
      SELECT c.SNo sno, c.ContainerNo containerNo, c.ContainerSealNo seal, sz.CSizeName size, ty.CTypeName type,
             c.GrossWeight grossWeight, c.NETWEIGHT netWeight, c.Pkgs pkgs, c.M3VOL cbm, c.TruckOrTrailerNo truck,
             c.DriverName driver, c.DriverCellNo driverCell, c.BiltyNo biltyNo, t.Name transporter,
             c.PortOutDate portOut, c.Remarks remarks
      FROM LSJobsContainers c
      LEFT JOIN LSContainerSizes sz ON sz.CSizePKId = c.ContainerSizePKId
      LEFT JOIN LSContainerTypes ty ON ty.CTypePKId = c.ContainerTypePKId
      LEFT JOIN LSCommonCodingsSetup t ON t.CommonCPkId = c.TransporterId
      WHERE c.JobMasterPKId = @id
      ORDER BY c.SNo, c.RowId`, p),
    query(book, `
      SELECT r.RowId rowId, r.SNo sno, ch.ChargesName charge, r.Remarks remarks, r.Qty qty, r.Rate rate,
             r.AmountLC amount, r.AmountFC amountFc, r.ExchRate exRate, pt.Name party, r.VehicleNo vehicle,
             r.IsApproved approved, r.InvoicePKId invoiceId, i.InvoiceNo invoiceNo
      FROM LSJobsReceivable r
      LEFT JOIN LSCharges ch ON ch.ChargesPKId = r.ChargesId
      LEFT JOIN LSCommonCodingsSetup pt ON pt.CommonCPkId = r.ClientId
      LEFT JOIN LSJobsInvoicesMaster i ON i.InvoicePKId = r.InvoicePKId
      WHERE r.JobMasterPKId = @id
      ORDER BY r.SNo, r.RowId`, p),
    query(book, `
      SELECT r.RowId rowId, r.SNo sno, ch.ChargesName charge, r.Remarks remarks, r.Qty qty, r.Rate rate,
             r.AmountLC amount, r.AmountFC amountFc, r.ExchRate exRate, pt.Name party, r.VehicleNo vehicle,
             r.IsApproved approved, r.ExpensePKId billId, e.ExpenseNo billNo
      FROM LSJobsPayable r
      LEFT JOIN LSCharges ch ON ch.ChargesPKId = r.ChargesId
      LEFT JOIN LSCommonCodingsSetup pt ON pt.CommonCPkId = r.VendorId
      LEFT JOIN LSJobsExpensesMaster e ON e.ExpensePKId = r.ExpensePKId
      WHERE r.JobMasterPKId = @id
      ORDER BY r.SNo, r.RowId`, p),
    query(book, `
      SELECT i.InvoicePKId id, i.InvoiceNo invoiceNo, i.InvoiceDate invoiceDate, i.InvoiceType invoiceType,
             pt.Name party, i.TotalAmount total, i.SaleTaxAmnt tax, i.NetAmount net, i.GStInvNo gstNo,
             i.IsVoid isVoid, i.VoucherTranId tranNo, m.voucnumb voucherNo
      FROM LSJobsInvoicesMaster i
      LEFT JOIN LSCommonCodingsSetup pt ON pt.CommonCPkId = i.CustomerId
      LEFT JOIN tranfile m ON m.trannumb = i.VoucherTranId
      WHERE i.JobMasterPKId = @id
      ORDER BY i.InvoiceDate, i.InvoicePKId`, p),
    query(book, `
      SELECT e.ExpensePKId id, e.ExpenseNo billNo, e.ExpenseDate billDate, ISNULL(pt.Name, ac.acctname) party,
             e.VendorBillNo vendorBillNo, e.TotalAmount total, e.NetAmount net, e.IsVoid isVoid,
             e.VoucherTranId tranNo, m.voucnumb voucherNo
      FROM LSJobsExpensesMaster e
      LEFT JOIN LSCommonCodingsSetup pt ON pt.CommonCPkId = e.VendorId
      LEFT JOIN acctfile ac ON ac.autonumb = e.AccountId
      LEFT JOIN tranfile m ON m.trannumb = e.VoucherTranId
      WHERE e.JobMasterPKId = @id
      ORDER BY e.ExpenseDate, e.ExpensePKId`, p),
  ]);

  const chargeLine = (r) => ({
    rowId: r.rowId,
    sno: r.sno,
    charge: r.charge || '',
    remarks: r.remarks || '',
    qty: money(r.qty),
    rate: money(r.rate),
    amount: money(r.amount),
    amountFc: money(r.amountFc),
    exRate: money(r.exRate),
    party: r.party || '',
    vehicle: r.vehicle || '',
    approved: Boolean(r.approved),
  });

  return {
    ...header,
    containers: containers.map((c) => ({
      sno: c.sno,
      containerNo: c.containerNo || '',
      seal: c.seal || '',
      size: c.size || '',
      type: c.type || '',
      grossWeight: money(c.grossWeight),
      netWeight: money(c.netWeight),
      pkgs: money(c.pkgs),
      cbm: money(c.cbm),
      truck: c.truck || '',
      driver: c.driver || '',
      driverCell: c.driverCell || '',
      biltyNo: c.biltyNo || '',
      transporter: c.transporter || '',
      portOut: wallDate(c.portOut),
      remarks: c.remarks || '',
    })),
    receivable: receivable.map((r) => ({ ...chargeLine(r), invoiceId: r.invoiceId || null, invoiceNo: r.invoiceNo || '' })),
    payable: payable.map((r) => ({ ...chargeLine(r), billId: r.billId || null, billNo: r.billNo || '' })),
    invoices: invoices.map((i) => ({
      id: i.id,
      invoiceNo: i.invoiceNo,
      invoiceDate: wallDate(i.invoiceDate),
      kind: i.invoiceType === 2 ? 'Credit Note' : 'Invoice',
      party: i.party || '',
      total: money(i.total),
      tax: money(i.tax),
      net: money(i.net),
      gstNo: i.gstNo || '',
      isVoid: Boolean(i.isVoid),
      tranNo: i.tranNo || null,
      voucherNo: i.voucherNo || '',
    })),
    bills: bills.map((b) => ({
      id: b.id,
      billNo: b.billNo,
      billDate: wallDate(b.billDate),
      party: b.party || '',
      vendorBillNo: b.vendorBillNo || '',
      total: money(b.total),
      net: money(b.net),
      isVoid: Boolean(b.isVoid),
      tranNo: b.tranNo || null,
      voucherNo: b.voucherNo || '',
    })),
  };
}

module.exports = { searchJobs, jobDetail, jobHeader, MODES, DIRECTIONS, STATUSES, STAGES };
