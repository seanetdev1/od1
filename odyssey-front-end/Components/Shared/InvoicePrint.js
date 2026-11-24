import React, { useEffect } from 'react';
import { Row, Col, Table } from 'react-bootstrap';
import moment from "moment";
import ports from "jsonData/ports";
import airports from "jsonData/airports";
import inWords from 'functions/numToWords';
import usePrintStamp from 'functions/usePrintStamp';
import { bankAccountFields, getCompany } from 'functions/companyBranding';
import SaleTaxInvoicePrint from './SaleTaxInvoicePrint';
import CustomsInvoiceHeader from './CustomsInvoiceHeader';
import DraftWatermark from './DraftWatermark';
import { isSaleTaxLine, lineFigures, saleTaxFigures } from 'functions/saleTaxInvoice';
import { placeName } from 'functions/placeName';
import { settlementLines } from 'functions/invoiceSettlementLines';
import { printCurrency, printsForeign, lineAmount } from 'functions/invoicePrintCurrency';
import { billToAddress } from 'functions/invoiceBillTo';
import { containerNumbers } from 'functions/customsJobReference';

const commas = (a) => parseFloat(a).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
// Minimum widths of the customs charges table's figure columns - see nowrap.
const NUMERIC_WIDTH = { qty: 50, rate: 80, tax: 70, total: 95 };

// vatInvoice: the Printing Options "VAT Tax Invoice" box. When ticked the
// invoice prints as the Sale Tax Invoice instead - see SaleTaxInvoicePrint.
// hideSignLine: Printing Options' "Hide Sign Line" - the signature line and the
// company name under it left off (Configuration > Invoices can tick it by default).
// hideBalance: "Hide Balance" - Received / Paid, Adjustment and Balance left off.
// hideTax: "Hide Tax Column", customs only (Configuration > Invoices can tick it
// by default) - see noTax below.
// hidePrintedBy: Printing Options' "Hide Printed On / By" - the line at the
// foot of the page, freight and customs alike (the user, 2026-11-02).
// hideBankDetails: Printing Options' "Hide Bank Details" (Configuration >
// Invoices can tick it by default; Essani, 2026-11-14).
// And from the install, sent with the invoice (invoice.printSettings - the
// server's attachPrintContext - so the emailed PDF prints as the screen does):
// containerNosInNote, a customs invoice's Note box listing its containers, and
// signDisclaimer, printed where the sign line was when it is hidden.
const InvoicePrint = ({logo, compLogo, company, records, bankAccount, invoice, note, reference, calculateTotal, systemGenerated, vatInvoice, shipperInMs, hideSignLine, hideBalance, hideTax, hidePrintedBy, hideBankDetails}) => {
    // `company` is the Company record. Supplied from redux on the interactive
    // screen and from the /invoice/getPrintData props in the headless PDF,
    // which has no store. Falls back to a lookup for older call sites.
    const comp = company || getCompany(compLogo) || {};
    const compLogoSrc = comp.printLogo || comp.logo || null;
    console.log("Invoice Print:", invoice)
    /* "CC" when any line is CC: the table then has a Type column (DN / CN).
     * Worked out from the lines on every render. It was state set once, on
     * mount - and the invoice screen mounts this print before the invoice has
     * loaded, with no lines, so the header never got its Type column while
     * every CC line still printed its DN: each figure sat one column to the
     * right, the Amount column reading "DN" (a user's screenshot of
     * SNS-AI-175/27, 2026-11-05). */
    const type = (records || []).some((x) => x?.pp_cc == "CC") ? "CC" : "PP"

    // The job's ports by Setup > Ports' (or Airports') names, sent with the
    // invoice - functions/printPlaces on the server. The built-in list here
    // has about 45,000 ports to Setup's 108,000, so one only Setup knows
    // printed as its code ("KHSIH"). The built-in list, then the code, for any
    // Setup lacks; "Sanshui (CNSJQ)" prints "Sanshui" - functions/placeName.
    const setupPlaces = Object.entries(invoice?.placeNames || {}).map(([id, name]) => ({ id, name }));
    const fromSetup = (id) => (invoice?.placeNames?.[id] ? placeName(setupPlaces, id) : null);
    const getPort = (id) => fromSetup(id) || placeName(ports.ports, id);
    const getAirPort = (id) => fromSetup(id) || placeName(airports, id);
    const isAir = invoice?.operation == "AE" || invoice?.operation == "AI";
    const commas = (a) =>  { return parseFloat(a).toFixed(2).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}

    useEffect(() => {
        // console.log(invoice)
        // console.log(records)
    }, [invoice])
    // Who and when: empty until in the browser - see functions/usePrintStamp.
    const stamp = usePrintStamp();
    
    const paraStyles = { lineHeight:1.2, fontSize:11 }
    const heading = { lineHeight:1, fontSize:11, fontWeight:'800', paddingBottom:5 };
    const Line = () => <div style={{backgroundColor:"black", height:3, position:'relative', top:12}}></div>
    const border = "1px solid black";

    // After every hook above, so the hook order is the same on both prints.
    if (vatInvoice) {
      // Shipper in M/S addresses the Sales Tax Invoice too, not only this one.
      return <SaleTaxInvoicePrint invoice={invoice} records={records} company={company} compLogo={compLogo} logo={logo}
        shipperInMs={shipperInMs} hidePrintedBy={hidePrintedBy} />;
    }
    // A customs clearance invoice prints its own party and job boxes - see
    // CustomsInvoiceHeader. customsJob is attached by the server whenever the
    // lines name a customs job; CC (raised here) and LG (migrated) cover one
    // read without it.
    const isCustoms = Boolean(invoice?.customsJob) || invoice?.operation === 'CC' || invoice?.operation === 'LG';

    // A TAXED CUSTOMS INVOICE prints as the legacy one does: the untaxed lines
    // (the pass-through expenses) first, then the taxed ones under "Service
    // Charges", then Total For Sales Tax, Sales Tax @ rate, and the invoice's
    // total without the tax and with it (the legacy form's "Balance Invoice").
    //
    // The taxed figures come from lineFigures, not local_amount: a migrated
    // line stores its value without the tax (2,500, with the 375 held apart)
    // and one added here stores it with (2,875), so summing local_amount
    // under-counts every migrated invoice by its tax.
    const taxSplit = isCustoms && (records || []).some(isSaleTaxLine);
    const expenseLines = taxSplit ? records.filter((x) => !isSaleTaxLine(x)) : (records || []);
    const taxedLines = taxSplit ? records.filter(isSaleTaxLine) : [];
    const saleTax = taxSplit ? saleTaxFigures(records) : null;
    // THE INVOICE'S OWN CURRENCY, as its Currency box sets it - not its type
    // (functions/invoicePrintCurrency).
    const currency = printCurrency(invoice);
    const foreign = printsForeign(invoice);
    const expensesTotal = taxSplit ? parseFloat(calculateTotal(expenseLines, foreign)) : 0;
    const invoiceTotal = taxSplit
      ? Math.round((expensesTotal + saleTax.serviceCharges + saleTax.saleTax) * 100) / 100
      : parseFloat(calculateTotal(records, foreign));
    // A customs invoice drops Curr, Amount and Dis - a customs line's amount
    // is a pricing multiplier fixed at 1, not money - and adds the line's own
    // Description (legacy Remarks / Description: "PLOT RENT", "SUNDAY EXP").
    //
    // HIDE TAX COLUMN (customs): the table has no Tax column, the service
    // charges show their value BEFORE tax, and Total For Sales Tax goes - the
    // lines above add up to it already. The tax is stated once, under them:
    // Sales Tax @ rate, then Total Without Tax and Total With Tax.
    const noTax = isCustoms && Boolean(hideTax);
    const columns = (isCustoms ? 7 : 9) + (type == "CC" ? 1 : 0) - (noTax ? 1 : 0);
    // The customs table's headings, shaded. ON THE CELLS, not the row:
    // Bootstrap 5.3 paints every table cell its own background, so a colour on
    // the <tr> is covered - the freight row's "silver" has never shown. And
    // marked exact, or the browser drops it when printing.
    const headShade = { backgroundColor: '#f0f0f0', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' };
    // The figures' columns on a customs invoice keep a minimum width, and their
    // figures stay on one line - otherwise a long Description/Remarks takes
    // the room and 93,996.00 wraps. A width on a cell of an auto-layout table
    // is a floor, not a cap: a wider figure still widens its column.
    const nowrap = isCustoms ? { whiteSpace: 'nowrap' } : {};
    // The charges table on a customs invoice is the size of the job boxes above
    // it (CustomsInvoiceHeader, 11) - at 9 it read as small print.
    const tableFont = isCustoms ? 11 : 9;
    // Note / In-Words on a customs invoice, underlined and clear of the text.
    const underlined = isCustoms ? { textDecoration: 'underline', textUnderlineOffset: '3px' } : undefined;
    // CONTAINER NOS IN THE NOTE BOX - Configuration > Invoices (Essani,
    // 2026-11-14): a customs invoice's box lists its job's containers in place
    // of the invoice's note - the rows' numbers, or the job's typed list when
    // it has no rows.
    const printSettings = invoice?.printSettings || {};
    const containerNos = isCustoms && printSettings.containerNosInNote
      ? containerNumbers(invoice?.customsJob)
      : null;
    // What prints where the sign line was, when it is hidden.
    const disclaimer = String(printSettings.signDisclaimer || '').trim();
    // The total with its round off, and under it Received (Paid on a bill),
    // Adjustment and Balance - see functions/invoiceSettlementLines.
    const roundOff = parseFloat(invoice?.roundOff) || 0;
    const totalAmount = invoiceTotal + roundOff;
    const settlement = settlementLines(invoice, totalAmount);

    // `figures` is set for a taxed line in the Service Charges section: its
    // tax and its value before tax, from lineFigures. Its Total Amount is the
    // two together - the Tax column beside it says how much of that is tax -
    // or, with the Tax column hidden, the value before tax alone.
    const grossAmount = (x) => Math.round(
      (parseFloat(x.amount) || 1) * (parseFloat(x.rate_charge) || 0) * (parseFloat(x.qty) || 0) * 100,
    ) / 100;
    const chargeRow = (x, index, figures) => (
    <tr key={`${figures ? 't' : 'e'}${index}`} className='table-row-center-singleLine' style={{border:'1px solid black', fontSize:tableFont}}>
        <td className='text-center p-0'>{index + 1}</td>
        {isCustoms ? <>
            <td className='p-0 px-1' style={{textAlign:'left'}}>{x.particular}</td>
            <td className='p-0 px-1' style={{textAlign:'left'}}>{x.description}</td>
        </> :
        <td className='text-center p-0'>{x.particular}</td>}
        <td className='text-center p-0' style={nowrap}>{commas(x.qty)}</td>
        <td className='text p-0' style={{textAlign:'right', ...nowrap}}>{commas(x.rate_charge)}</td>
        {!isCustoms && <td className='text-center p-0'>{x.currency}</td>}
        {/* A cell on every line once the table has a Type column - blank on a
            PP line, which otherwise slid one column to the left. */}
        {type=="CC"?<td className='text-center p-0'>{x.pp_cc=="CC" ? (x.type=="Recievable"?"DN":"CN") : ""}</td>:null}
        {!isCustoms && <>
        {/* The line before discount: qty x rate. `amount` itself is the pricing
            multiplier - 1 - and printed as it stood, the column read 1. */}
        <td className='text p-0' style={{textAlign:'right'}}>{commas(grossAmount(x))}</td>
        <td className='text p-0' style={{textAlign:'right'}}>{commas(x.discount)}</td>
        </>}
        {!noTax && <td className='text p-0' style={{textAlign:'right', ...nowrap}}>{commas(figures ? figures.tax : x.tax_amount)}</td>}
        <td className='text p-0' style={{textAlign:'right', ...nowrap}}>
            {
            figures ? commas(Math.round((figures.taxable + (noTax ? 0 : figures.tax)) * 100) / 100) :
                commas(lineAmount(x, foreign).toFixed(2))
            }
            </td>
    </tr>
    );
    const totalRow = (label, value) => (
    <tr key={label} style={{border:'1px solid black', fontSize:tableFont}}>
        <td colSpan={columns - 1} className='p-0 px-2' style={{textAlign:'right', fontWeight:800}}>{label}</td>
        <td className='p-0' style={{textAlign:'right', fontWeight:800, ...nowrap}}>{value}</td>
    </tr>
    );
    
  return (
    <div className='invoice-print-root pb-5 px-5 pt-4' style={{ page: 'invoicePortrait', position: 'relative' }}>
      <style>{`@media print { @page invoicePortrait { size: A4 portrait; margin: 0; } .invoice-print-root { page: invoicePortrait; } }`}</style>
      <DraftWatermark invoice={invoice} />
    <Row>
        {!logo && compLogoSrc &&
        <Col md={4} className='text-center'>
            {/* In its own colours - no invert filter, which greyed it out
                (see Components/Shared/CompanyLetterhead). */}
            <img src={compLogoSrc} height={100} alt=""/>
        </Col>
        }
        <Col>
        <div className='text-center '>
            {comp.title && <div style={{fontSize:20}}><b>{comp.title}</b></div>}
            {comp.address && <div style={paraStyles}>{comp.address}</div>}
            {comp.phone && <div style={paraStyles}>Tel: {comp.phone}</div>}
            {(comp.email || comp.web) &&
              <div style={paraStyles}>
                {comp.email && <>Email: {comp.email}</>}{comp.email && comp.web && <>{'   '}</>}{comp.web && <>Web: {comp.web}</>}
              </div>}
            {comp.ntn && <div style={paraStyles}>NTN # {comp.ntn}</div>}
            {comp.strn && <div style={paraStyles}>STRN # {comp.strn}</div>}
        </div>
        </Col>
    </Row>
    <Row>
        <Col md={5}><Line/></Col>
        <Col md={2}>
            <div className={`text-center ${isCustoms ? 'fs-16' : 'fs-15'}`} style={{whiteSpace:'nowrap'}}>
                <strong>{invoice.type}</strong>
            </div>
        </Col>
        <Col md={5}><Line/></Col>
    </Row>
    {isCustoms ? <CustomsInvoiceHeader invoice={invoice} reference={reference} shipperInMs={shipperInMs} /> : <>
    <Row style={{paddingLeft:12, paddingRight:12}}>
        <Col md={6} style={{borderTop:border, borderRight:border, borderLeft:border, borderBottom:border, maxHeight:70, overflow:'hidden'}} className='p-0 px-1'>
            <div style={heading}>INVOICE TO</div>
            <div style={paraStyles}>{invoice.party_Name}</div>
            {/* The invoiced party's address, not the job client's - see
                functions/invoiceBillTo. */}
            {billToAddress(invoice).map((line) => <div key={line} style={paraStyles}>{line}</div>)}
            {/* <div style={paraStyles}>{invoice.SE_Job.Client?.infoMail}</div> */}
            {/* <div style={paraStyles}>{invoice.SE_Job.Client?.telephone1}</div> */}
            {/* <div style={paraStyles}>{invoice.SE_Job.Client?.mobile1}</div> */}
        </Col>
        <Col md={6} style={{  borderTop:border, borderBottom:border, borderRight:border, maxHeight:70, overflow:'hidden'}} className='p-0 px-1'>
        <div style={heading}>Shipper/Consignee</div>
            <div style={paraStyles}>{invoice?.SE_Job?.shipper?.name} / </div>
            <div style={paraStyles}>{invoice?.SE_Job?.consignee?.name}</div>
            <div style={paraStyles}>{invoice?.SE_Job?.consignee?.address1}</div>
            {/* <div style={paraStyles}>{invoice.SE_Job.Client?.infoMail}</div> */}
            {/* <div style={paraStyles}>{invoice.SE_Job.consignee?.telephone1}</div> */}
            {/* <div style={paraStyles}>{invoice.SE_Job.consignee?.mobile1}</div> */}
        </Col>
    </Row>
    {!reference && <Row style={{paddingLeft:12, paddingRight:12}}>
        <Col md={6} style={{borderRight:border, borderLeft:border, borderBottom:border}} className='p-0 px-1'>
            <span style={heading}>Reference No.</span>
            {console.log(invoice?.SE_Job)}
            <span style={{...paraStyles, paddingLeft:70}}>{invoice?.SE_Job?.customerRef}</span>
        </Col>
        <Col md={6} style={{borderRight:border, borderBottom:border}} className='p-0 px-1'>
            <span style={heading}>Sales Rep</span>
            <span style={{...paraStyles, paddingLeft:70}}>{invoice?.SE_Job?.sales_representator?.name}</span>
        </Col>
    </Row>}
    <Row style={{paddingLeft:12, paddingRight:12}}>
        <Col md={6} style={{borderRight:border, borderLeft:border, borderBottom:border}} className='p-1'>
            <Row>
                <Col md={7}>
                    <div style={heading}>{(invoice.operation=="SE"||invoice.operation=="SI")?"MBL":"MAWB"} No.</div>
                    <div style={paraStyles}>{invoice.SE_Job?.Bl?.mbl}</div>
                </Col>
                <Col md={5}>
                    <div style={heading}>{(invoice.operation=="SE"||invoice.operation=="SI")?"Bill of Lading":"HAWB No."} </div>
                    <div style={paraStyles}>{invoice.SE_Job?.Bl?.hbl}</div>
                </Col>
            </Row>
        </Col>
        <Col md={6} style={{borderRight:border, borderBottom:border}} className='p-1'>
            <Row>
                <Col md={7}>
                    <div style={heading}>Job No</div>
                    <div style={paraStyles}>{invoice?.SE_Job?.jobNo}</div>
                    
                </Col>
                <Col md={5}>
                    <div style={heading}>Job Date</div>
                    <div style={paraStyles}>{moment(invoice?.SE_Job?.jobDate).format("DD-MMM-YYYY")}</div>
                </Col>
            </Row>
        </Col>
    </Row>
    <Row style={{paddingLeft:12, paddingRight:12}}>
        <Col md={6} style={{borderRight:border, borderLeft:border, borderBottom:border}} className='p-1'>
            <Row>
                <Col md={7}>
                    <div style={heading}>{(invoice.operation=="SE"||invoice.operation=="SI")?"Vessel / Voyage":"Airline / Flight No."}</div>
                    <div style={paraStyles}>
                        {
                            (invoice.operation=="SE"||invoice.operation=="SI") &&
                            <>
                                {invoice.SE_Job?.vessel?.name} / {invoice.SE_Job?.Voyage?.voyage}
                            </>
                        }
                        {
                            isAir &&
                            <>
                                {invoice.SE_Job?.air_line?.name} / {invoice.SE_Job?.flightNo}
                            </>
                        }
                    </div>
                </Col>
                <Col md={5}>
                <div style={heading}>
                    {(invoice.operation=="SI"|| invoice.operation=="AI")?"Arrival Date":"Departure Date"}
                </div>
                    <div style={paraStyles}>
                        {
                            (invoice.operation=="AI"||invoice.operation=="SI") ?
                            <>
                                {invoice.SE_Job?.eta?moment(invoice.SE_Job?.eta).format("DD-MMM-YYYY"):''}
                            </>
                            :
                            <>
                                {invoice.SE_Job?.shipDate?moment(invoice.SE_Job?.shipDate).format("DD-MMM-YYYY"):''}
                            </>
                        }
                    </div>
                </Col>
            </Row>
        </Col>
        <Col md={6} style={{borderRight:border, borderBottom:border}} className='p-1'>
            <Row>
                <Col md={7}>
                    <div style={heading}>Invoice No</div>
                    <div style={paraStyles}>{invoice.invoice_No}</div>
                </Col>
                <Col md={5}>
                    <div style={heading}>Invoice Date</div>
                    <div style={paraStyles}>
                        {/* {
                            (invoice.operation=="AI"||invoice.operation=="SI") ?
                            <>
                                {invoice.createdAt?moment(invoice.createdAt).format("DD-MMM-YYYY"):''}
                                </>
                            :
                            <>
                                {invoice.SE_Job?.departureDate?moment(invoice.SE_Job?.departureDate).format("DD-MMM-YYYY"):''}
                            </>
                        } */}
                        {invoice.createdAt?moment(invoice.createdAt).format("DD-MMM-YYYY"):''}
                    </div>
                </Col>
            </Row>
        </Col>
    </Row>
    <Row style={{paddingLeft:12, paddingRight:12}}>
        <Col md={6} style={{borderRight:border, borderLeft:border, borderBottom:border}} className='p-1'>
            <Row>
                <Col md={7}>
                    {(invoice.operation == 'SE' || invoice.operation == 'SI') && <div style={heading}>Port of Loading</div>}
                    {(invoice.operation == 'AE' || invoice.operation == 'AI') && <div style={heading}>Airport of Loading</div>}
                    <div style={paraStyles}>
                        {(invoice.operation=="SE"||invoice.operation=="SI")? getPort(invoice.SE_Job?.pol):getAirPort(invoice.SE_Job?.pol)}
                    </div>
                </Col>
                <Col md={5}>
                    {(invoice.operation == 'SE' || invoice.operation == 'SI') && <div style={heading}>Port of Discharge</div>}
                    {(invoice.operation == 'AE' || invoice.operation == 'AI') && <div style={heading}>Airport of Discharge</div>}
                    <div style={paraStyles}>
                        {(invoice.operation=="SE"||invoice.operation=="SI")? getPort(invoice.SE_Job?.pod)||invoice.SE_Job?.pod:getAirPort(invoice.SE_Job?.pod)||invoice.SE_Job?.pod}
                    </div>
                </Col>
            </Row>
        </Col>
        <Col md={6} style={{borderRight:border, borderBottom:border}} className='p-1'>
            <Row>
                <Col md={7}>
                    <div style={heading}>Destination Port</div>
                    <div style={paraStyles}>
                        {/* The name alone - it printed the name and then the code, "SanshuiCNSJQ". */}
                        {isAir ? getAirPort(invoice.SE_Job?.fd) : getPort(invoice.SE_Job?.fd)}
                    </div>
                </Col>
                <Col md={5}>
                    <div style={heading}>{(invoice.operation=="SE"||invoice.operation=="SI")?"Shipping Line":"Airline"}</div>
                    <div style={paraStyles}>
                    {
                            (invoice.operation=="SE"||invoice.operation=="SI") &&
                            <>
                                {invoice.SE_Job?.vessel?.name} / {invoice.SE_Job?.Voyage?.voyage}
                            </>
                        }
                        {
                            isAir &&
                            <>
                                {invoice.SE_Job?.air_line?.name} / {invoice.SE_Job?.flightNo}
                            </>
                        }
                    </div>
                </Col>
            </Row>
        </Col>
        <Col md={6} style={{borderRight:border, borderLeft:border, borderBottom:border}} className='p-1'>
            <Row>
                <Col md={4}>
                    <div style={heading}>{(invoice.operation=="SE"||invoice.operation=="SI")?"Volume":"Ch. Weight"}</div>
                    <div style={paraStyles}>
                        {invoice?.payType=="Recievable" &&<>
                            {
                            (invoice.operation=="SE"||invoice.operation=="SI")?
                                commas(parseFloat(invoice?.SE_Job?.vol).toFixed(2)):
                                commas(parseFloat(invoice?.SE_Job?.cwtClient).toFixed(2))
                            }
                        </>}
                        {invoice?.payType!="Recievable" && <>0.00</>}
                    </div>
                </Col>
                <Col md={4}>
                    <div style={heading}>Weight</div>
                    <div style={paraStyles}>
                        {invoice.SE_Job?.weight?commas(parseFloat(invoice.SE_Job?.weight).toFixed(2)):"0.00"}
                    </div>
                </Col>
                <Col md={4}>
                    <div style={heading}>PCS</div>
                    <div style={paraStyles}>
                        {(invoice.operation=="SE"||invoice.operation=="SI") && <>
                            {/* Guarded the whole way down, like CLPrint - a job
                                with no equipment rows comes back with null
                                rather than an empty array. */}
                            {invoice.SE_Job?.SE_Equipments?.length>0 && 
                            <>
                            {  
                                invoice.SE_Job.SE_Equipments.map((z, i)=>{
                                    return(<span key={i}>{z.qty} x {z.size}</span>)
                                })
                            }
                            </>
                            }
                        </>}
                        {(invoice.operation!="SE"||invoice.operation!="SI")&&
                        <>
                            {invoice?.SE_Job?.pcs}
                        </>}
                    </div>
                </Col>
            </Row>
        </Col>
        <Col md={6} style={{borderRight:border, borderBottom:border}} className='p-1'>
            <Row>
                <Col md={7}>
                    <div style={heading}>Currency</div>
                    <div style={paraStyles}>{currency}</div>
                    
                </Col>
                <Col md={5}>
                    <div style={heading}>Exchange Rate</div>
                    <div style={paraStyles}>{records.length>0?invoice.ex_rate:''}</div>
                </Col>
            </Row>
        </Col>
        {(invoice.operation=="SE"||invoice.operation=="SI") &&
        <Col md={12} style={{borderLeft:'1px solid black', borderRight:'1px solid black'}} className=''>
            <Row>
                <Col md={12}>
                    <>
                        <span style={heading}>Container #</span>
                        <span className='mx-2'></span>
                        {invoice.SE_Job?.Bl?.Container_Infos.length>0 &&<>
                        {invoice.SE_Job?.Bl?.Container_Infos.map((z, i)=>{
                            return(
                                <span className='mx-1' style={paraStyles} key={i}>{z.no}, </span>
                            )
                        })}
                        </>
                        }
                    </>
                </Col>
            </Row>
        </Col>}
    </Row>
    </>}
    <Table className='pb-0 mb-0' bordered variant='white' size='sm'>
    <thead className='p-0 m-0'>
        {isCustoms ?
        <tr className='p-0 m-0' style={{border:'1px solid black', fontSize:tableFont, color:"black"}}>
        <td className='p-0 text-center fw-6' style={headShade}>Sr.</td>
        <td className='p-0 px-1 fw-6' style={{...headShade, textAlign:'left'}}>Charges</td>
        <td className='p-0 px-1 fw-6' style={{...headShade, textAlign:'left'}}>Description/Remarks</td>
        <td className='p-0 text-center fw-6' style={{...headShade, width:NUMERIC_WIDTH.qty}}>Qty</td>
        <td className='p-0 text-center fw-6' style={{...headShade, width:NUMERIC_WIDTH.rate}}>Rate</td>
        {type=="CC"?<td className='p-0 text-center fw-6' style={headShade}>Type</td>:null}
        {!noTax && <td className='p-0 text-center fw-6' style={{...headShade, width:NUMERIC_WIDTH.tax}}>Tax</td>}
        <td className='p-0 text-center fw-6' style={{...headShade, width:NUMERIC_WIDTH.total}}>Total Amount</td>
        </tr> :
        <tr className='p-0 m-0' style={{border:'1px solid black', backgroundColor:'silver', fontSize:9, color:"black"}}>
        <td className='p-0 text-center fw-6'>Sr.         </td>
        <td className='p-0 text-center fw-6'>Charges     </td>
        <td className='p-0 text-center fw-6'>Qty         </td>
        <td className='p-0 text-center fw-6'>Rate        </td>
        <td className='p-0 text-center fw-6'>Curr        </td>
        {type=="CC"?<td className='p-0 text-center fw-6'>Type        </td>:null}
        <td className='p-0 text-center fw-6'>Amount      </td>
        <td className='p-0 text-center fw-6'>Dis         </td>
        <td className='p-0 text-center fw-6'>Tax         </td>
        <td className='p-0 text-center fw-6'>Total Amount</td>
        </tr>}
    </thead>
    <tbody>
    {expenseLines.map((x, index) => chargeRow(x, index))}
    {taxSplit && <>
        {expenseLines.length > 0 && totalRow('Total Expenses :', commas(expensesTotal))}
        <tr style={{border:'1px solid black', fontSize:tableFont}}>
            <td colSpan={columns} className='p-0 px-1 fw-6' style={headShade}>Service Charges</td>
        </tr>
        {taxedLines.map((x, index) => chargeRow(x, index, lineFigures(x)))}
        {!noTax && totalRow('Total For Sales Tax :', commas(saleTax.serviceCharges))}
        {totalRow(`Sales Tax @ ${saleTax.rate !== null ? `${saleTax.rate} %` : '(rates vary by line)'} :`, commas(saleTax.saleTax))}
        {totalRow('Total Without Tax :', commas(invoiceTotal - saleTax.saleTax))}
        {totalRow('Total With Tax :', commas(invoiceTotal))}
    </>}
    {/* No tax on it, so one total - "without" and "with" would be the same
        figure twice. */}
    {isCustoms && !taxSplit && totalRow('Total :', commas(invoiceTotal))}
    {/* A ROUNDED customs invoice (Configuration > Invoices can round every
        one) states its round off and the total it comes to, as the ledger has
        it. Nothing else is added: the customs form has no Received or Balance
        under its table, as the legacy one had none. */}
    {isCustoms && roundOff !== 0 && <>
        {totalRow('Round Off :', invoice.roundOff)}
        {totalRow('Total Amount :', commas(totalAmount))}
    </>}
    </tbody>
    </Table>
    {/* A customs invoice states its totals once, in the table above (with its
        round off when it has one), and has nothing below it - no advance, no
        received or balance, as the legacy CargoLinkers form. */}
    {!isCustoms &&
    <Row style={{borderRight:border, borderLeft:border, borderBottom:border}} className='mx-0 pt-1'>
    <Col md={4} style={{fontSize:10}}><b className='fw-8'>Total Discount</b> <span style={{float:'right'}} className='px-3'>0.00</span></Col>
    <Col md={4} style={{fontSize:10}}><b className='fw-8'>Tax Amount</b>     <span style={{float:'right'}} className='px-3'>0.00</span></Col>
    <Col md={4} style={{fontSize:10}}>
        {foreign?
        <></>:
        <div>
            <b className='fw-8'>Invoice Total {"("}PKR{")"}</b>
            <span style={{float:'right'}}>
                {commas(invoiceTotal)}
                {/* invoice.ex_rate */}
            </span>
        </div>
        }
        <div><b className='fw-8'>Round Off </b> <span style={{float:'right'}} >{invoice.roundOff}</span></div>
        <div>
            <b className='fw-8'>Total Amount </b>
            <span style={{float:'right'}}>
                {commas(totalAmount)}
            </span>
            {/* (invoice.type=="Agent Invoice"||invoice.type=="Agent Bill")?
                (parseFloat(x.local_amount)/parseFloat(x.ex_rate)).toFixed(2):
                x.local_amount
            } */}
        </div>
        {!hideBalance && settlement.map((l) => (
            <div key={l.label}><b className='fw-8'>{l.label} </b> <span style={{float:'right'}}>{commas(l.value)}</span></div>
        ))}
    </Col>
    </Row>}
    <Row className='mx-0'>
        <Col md={6} className='p-1' style={{borderRight:border, borderLeft:border, borderBottom:border, fontSize:12}}>
        {containerNos !== null ? <>
            <b className='fw-8' style={underlined}>Container Nos</b>
            <div className='invoice-container-nos' style={{minHeight:60, lineHeight:1.3, fontSize:11}}>{containerNos}</div>
        </> : <>
        <b className='fw-8' style={underlined}>Note</b>
        {!note &&<>
            <div style={{minHeight:60, lineHeight:1}} >
                {invoice?.note?.length>40 && 
                <div className="bl-print" style={{color:'black', whiteSpace:'pre-wrap'}}>{invoice.note}</div>
                }
            </div></>}
        </>}
        </Col>
        <Col md={6} className='p-1' style={{borderRight:border, borderBottom:border, fontSize:12}}>
            <b className='fw-8' style={underlined}>In-Words</b>
            <p>
                {/* The total already in the invoice's currency - it was divided by
                    the rate a second time on an agent invoice. */}
                {currency} {" "}
                {inWords(totalAmount)}
            </p>
        </Col>
    </Row>
    {!hideBankDetails &&
    <Row className='mx-0'>
        <Col md={6} className='p-1' style={{borderRight:border, borderLeft:border, borderBottom:border}}>
            <b className='fw-8' style={{fontSize:12}}>Bank Details</b>
            {/* One BankAccount row from the DB, not a hardcoded constant - a
                row per field, label and value in columns. It was one block of
                text at lineHeight 0.7, which printed every line over the next,
                and nudged 10px out of its own box. */}
            <table style={{fontSize:11, lineHeight:1.35, borderCollapse:'collapse', marginTop:2}}>
              <tbody>
                {bankAccountFields(bankAccount).map(([label, value]) => (
                  <tr key={label}>
                    <td style={{border:'none', padding:'0 8px 0 0', whiteSpace:'nowrap', verticalAlign:'top', fontWeight:600}}>{label}</td>
                    <td style={{border:'none', padding:0, verticalAlign:'top'}}>: {value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
        </Col>
    </Row>}
    <div className='mt-5'>
        <Row className='justify-content-center'>
            <Col md={3} className='fs-10'></Col>
            <Col md={3} className='fs-10'></Col>
            <Col md={6} className='text-center'>
                {systemGenerated ?
                <div className='fs-11' style={{fontStyle:'italic'}}>This invoice is system generated and does not require a signature.</div>
                : !hideSignLine ?
                <div className='invoice-sign-line'>
                <div>__________________________</div>
                <div className='fs-12 px-5'><b>{comp.title}</b></div>
                </div>
                // The install's disclaimer where the line was (Configuration >
                // Invoices) - nothing when it has none, as before.
                : disclaimer &&
                <div className='invoice-sign-disclaimer fs-11' style={{fontStyle:'italic', whiteSpace:'pre-wrap'}}>{disclaimer}</div>
                }
            </Col>
        </Row>
    </div>
    {!hidePrintedBy &&
    <div className='mt-3'>
        <Row className='justify-content-center'>
            <Col md={4} className='fs-10'>Printed On: <span className='mx-2'>{stamp.at ? moment(stamp.at).format("DD / MMM / YYYY") : ''}</span></Col>
            <Col md={4} className='fs-10'>Printed By: {stamp.by}</Col>
            <Col md={4} className=''>
            </Col>
        </Row>
    </div>}
    </div>
  )
}

export default React.memo(InvoicePrint)
