import axiosClient from 'apis/axiosClient';
import React, { useState, useEffect } from 'react';
import CSVReader from 'react-csv-reader';
import moment from 'moment';
import { delay } from "functions/delay"
import { companyPrefixLength } from 'functions/companyBranding';

// One-time opening-balance migration tool from the Climax cutover.
//
// This file used to be 50,627 lines. The component is the ~300 below; the
// other ~50,300 were four literal arrays (paybleOne..paybleFour, 662 records
// each) of real payable invoices - party names, invoice numbers and amounts
// dating 2011-2024. Three of the four were never referenced at all.
//
// Real financial records do not belong in a source repo. They were also one
// import away from the client bundle: as module-level constants in a
// component, webpack would have inlined all 2,648 into the JavaScript served
// to browsers the moment this screen was wired up. (It isn't today - the JSX
// tag is commented out in Uploader.js, and Uploader.js itself is imported by
// nothing, so the whole tree is currently orphaned and unbundled.)
//
// The data now lives in seeds/openingInvoices.seed.json, which is gitignored,
// and is loaded on demand only when someone runs the upload. See
// seeds/README.md.
async function loadSeed() {
  try {
    // Dynamic, so the data is only fetched when an upload is triggered - and
    // so a build with no seed file present still compiles.
    const mod = await import('seeds/openingInvoices.seed.json');
    return mod.default || mod;
  } catch (err) {
    console.error('Opening-invoice seed not found (seeds/openingInvoices.seed.json).', err);
    return null;
  }
}

const Uploader = () => {

    // for receivable invoices only
    const [finalList, setFinalList] = useState([]);
    const [failedList, setFailedList] = useState([]);
    const [invoiceIndex, setInvoiceIndex] = useState(0);

    // for payble invoices only
    const [finalListPay, setFinalListPay] = useState([]);
    const [failedListPay, setFailedListPay] = useState([]);
    const [invoiceIndexPay, setInvoiceIndexPay] = useState(0);

    const parserOptions = {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        transformHeader: header => header.toLowerCase().replace(/\W/g, '_')
    }

    const handleOpeningInvoicesReceivable = async(data) => {
        let list = [];
        // Plain for...of: the callback only builds rows and pushes them, so the
        // async/await here never bought anything - it just meant `list` could be
        // read by the console.log below before the pushes had all happened.
        for (const x of data) {
            let title = x.client? x.client.slice(0, x.client.lastIndexOf("(")-1):'';
            if(x.receivable!=null){

                let receivable = `${x.receivable}`?.replaceAll(',', '');
                receivable = parseFloat(receivable[0]=="("?`-${receivable.slice(1, -1)}`:receivable);

                let received = `${x.received}`?.replaceAll(',', '');
                received = parseFloat(received[0]=="("?`-${received.slice(1, -1)}`:received);

                let adjust = `${x.adjust}`?.replaceAll(',', '');
                adjust = parseFloat(adjust[0]=="("?`-${adjust.slice(1, -1)}`:adjust);

                let invNo = `${x.invoice_no!=null?x.invoice_no:''}${x.inv_no!=null?x.inv_no:''}${x.bill_no!=null?x.bill_no:''}`;
                let newInvNo = "";

                const prefixLen = companyPrefixLength(invNo);
            newInvNo = prefixLen
              ? invNo.slice(0, prefixLen) + "O" + invNo.slice(prefixLen)
              : invNo;
                console.log(newInvNo);
                list.push({
                    companyId:3,
                    party_Name:title, 
                    jobNo:`${x.jobnumber}`.trim(), 
                    currency:x.curr, 
                    operation:x.operationcode==null?"SE":x.operationcode,
                    ex_rate:1,
                    type:"Old Job Invoice",
                    payType:"Recievable",
                    status:(received + adjust)>0?'3':'1',
                    invoice_No:newInvNo,
                    paid:0,
                    roundOff:0,
                    approved:1,
                    total:receivable,
                    createdAt:`${moment(x.date).format("YYYY-MM-DD")}`,
                    receivable: receivable,
                    received: received + adjust,
                    balance: receivable - (received + adjust)
                })
            }
        }
        console.log(list)
        let tempreceivable = 0;
        let tempreceived = 0;
        let tempbalance = 0;
        list.forEach((x)=>{
            tempreceivable = tempreceivable + x.receivable
            tempreceived = tempreceived + x.received
            tempbalance = tempbalance + x.balance
        })
        console.log("receivable", tempreceivable);
        console.log("received",tempreceived);
        console.log("balance",tempbalance);
    }

    // The receivable list is built by the CSV reader above (handleOpening-
    // InvoicesReceivable), not from the seed - the seed only ever held payables.
    const uploadRecivableInvoices = async() => {
        const finalInvoiceList = [];
        const failed = [];
        // for...of + await, not forEach(async) + a floating .then(): the old
        // version fired all N posts at once with nothing awaiting them, so it
        // returned immediately and the success/failure lists it built were
        // whatever had happened to resolve by the time anyone looked.
        for (let i = 0; i < finalList.length; i++) {
            const x = finalList[i];
            try {
                const y = await axiosClient.post("/invoice/uploadbulkInvoicesTest", x);
                setInvoiceIndex(i);
                if (y.data.status == "success" && y.data.result) {
                    finalInvoiceList.push(y.data.result);
                    setFinalList((z)=>[...z, {...x, party_Id:y.data.result}]);
                } else {
                    failed.push(x);
                    setFailedList((z)=>[...z, x]);
                }
            } catch (err) {
                failed.push(x);
                setFailedList((z)=>[...z, x]);
            }
        }
        console.log(`receivable: ${finalInvoiceList.length} uploaded, ${failed.length} failed`);
    }

    const handleOpeningInvoicesPayble = async(data) => {
        let list = [];
        // Plain for...of: the callback only builds rows and pushes them, so the
        // async/await here never bought anything - it just meant `list` could be
        // read by the console.log below before the pushes had all happened.
        for (const x of data) {
            let title = x.vendor? x.vendor.slice(0, x.vendor.lastIndexOf("(")-1):'';
            if(x.payable!=null){

                let payable = `${x.payable}`?.replaceAll(',', '');
                payable = parseFloat(payable[0]=="("?`-${payable.slice(1, -1)}`:payable);

                let paid = `${x.paid}`?.replaceAll(',', '');
                paid = parseFloat(paid[0]=="("?`-${paid.slice(1, -1)}`:paid);

                let adjust = `${x.adjust}`?.replaceAll(',', '');
                adjust = parseFloat(adjust[0]=="("?`-${adjust.slice(1, -1)}`:adjust);

                let invNo = `${x.invoice_no!=null?x.invoice_no:''}${x.inv_no!=null?x.inv_no:''}${x.bill_no!=null?x.bill_no:''}${x.billno!=null?x.billno:''}`;
                let newInvNo = "";

                const prefixLen = companyPrefixLength(invNo);
            newInvNo = prefixLen
              ? invNo.slice(0, prefixLen) + "O" + invNo.slice(prefixLen)
              : invNo;
                console.log(newInvNo);
                list.push({
                    companyId:3,
                    party_Name:title, 
                    jobNo:`${x.jobnumber}`.trim(), 
                    currency:x.curr, 
                    operation:x.operationcode==null?"SE":x.operationcode,
                    ex_rate:1,
                    type:"Old Job Bill",
                    payType:"Payble",
                    status:(paid + adjust)>0?'3':'1',
                    invoice_No:newInvNo,
                    paid:0,
                    roundOff:0,
                    approved:1,
                    total:payable,
                    createdAt:`${moment(x.date).format("YYYY-MM-DD")}`,
                    payable: payable,
                    paid: paid + adjust,
                    balance: payable - (paid + adjust)
                })
            }

        }
        console.log(list)
        let tempreceivable = 0;
        let tempreceived = 0;
        let tempbalance = 0;
        list.forEach((x)=>{
            tempreceivable = tempreceivable + x.payable
            tempreceived = tempreceived + x.paid
            tempbalance = tempbalance + x.balance
        })
        console.log("payble", tempreceivable, "paid",tempreceived, "balance",tempbalance);
    }

    const uploadPaybleInvoices = async() => {
        const seed = await loadSeed();
        if (!seed) {
            console.error('Nothing to upload: seeds/openingInvoices.seed.json is missing.');
            return;
        }
        // Was hardcoded to paybleFour - one of four identically-shaped batches
        // the data had been split into, with the other three left unreferenced.
        const batch = seed.paybleFour || [];

        const finalInvoiceList = [];
        const failed = [];
        // Sequential and awaited - see uploadRecivableInvoices above. The old
        // forEach(async) also meant a URL hardcoded to localhost:8082, a port
        // nothing in this deployment listens on; it now goes through
        // axiosClient's configured base URL like every other call.
        for (let i = 0; i < batch.length; i++) {
            const x = batch[i];
            try {
                const y = await axiosClient.post("/invoice/uploadbulkInvoicesTest", x);
                setInvoiceIndexPay(i);
                if (y.data.status == "success" && y.data.result) {
                    finalInvoiceList.push(y.data.result);
                    setFinalListPay((z)=>[...z, {...x, party_Id:y.data.result}]);
                } else {
                    failed.push(x);
                    setFailedListPay((z)=>[...z, x]);
                }
            } catch (err) {
                failed.push(x);
                setFailedListPay((z)=>[...z, x]);
            }
        }
        console.log(`payable: ${finalInvoiceList.length} uploaded, ${failed.length} failed`);
    }

    // ---------------------Receivable Invoices---------------------
    // useEffect(() => {
    //   console.log(finalList)
    // }, [finalList])

    // useEffect(() => {
    //   console.log("failed", failedList)
    // }, [failedList])

    // useEffect(()=> {
    //     const midIndex = Math.floor(recivableInvoices.length / 2);
    //     const partOne = recivableInvoices.slice(0, midIndex);
    //     const partTwo = recivableInvoices.slice(midIndex);
    //     console.log({
    //         partOne,
    //         partTwo
    //     });
    // }, [])
    // ---------------------Receivable Invoices---------------------

    const here = null

    // ---------------------Payble Invoices---------------------
    useEffect(() => {
        console.log(finalListPay)
    }, [finalListPay])

    useEffect(() => {
    console.log("Error Here",failedListPay)
    }, [failedListPay])


    // useEffect(()=> {
    //     const midIndex = Math.floor(paybleList.length / 4);
    //     const partOne = paybleList.slice(0, midIndex);
    //     const partTwo = paybleList.slice(midIndex, midIndex*2);
    //     const partThree = paybleList.slice(midIndex*2, midIndex*3);
    //     const partFour = paybleList.slice(midIndex*3);

    //     console.log({
    //         partOne,
    //         partTwo,
    //         partThree,
    //         partFour
    //     });
    // }, [])
    // ---------------------Payble Invoices---------------------
    
    // useEffect(() => {
    //     let one = [];
    //     let two = [];
    //     paybleList.forEach((x, i)=>{
    //         i%2==0?one.push(x):two.push(x)
    //     })
    //     console.log(one)
    //     console.log(two)
    // }, [paybleList])
    
    // useEffect(() => {
    //     if(invoiceIndex+1==recivableInvoices.length){
    //         console.log(finalList)
    //         console.log(failedList)
    //     }
    // }, [finalList, failedList])

    // useEffect(() => {
    //     if(invoiceIndexPay+1==paybleTwo.length){
    //         console.log(finalListPay)
    //         console.log(failedListPay)
    //     }
    // }, [finalListPay, failedListPay])

  return (
  <>
    <h6>Clients / Vendors</h6>
    <hr/>
    <div className='mt-4'><b>Make Receivable Opening Invoices</b></div>
    <CSVReader
        cssClass="csv-reader-input"
        onFileLoaded={handleOpeningInvoicesReceivable}
        parserOptions={parserOptions}
        disabled={false}
        inputId="ObiWan"
        inputName="ObiWan"
    />
    <button onClick={uploadRecivableInvoices} className='btn-custom mt-3'>Upload</button>
    <hr/>
    <div className='mt-4'><b>Make Payble Opening Invoices</b></div>
    <CSVReader
        cssClass="csv-reader-input"
        onFileLoaded={handleOpeningInvoicesPayble}
        parserOptions={parserOptions}
        disabled={false}
        inputId="ObiWan"
        inputName="ObiWan"
    />
    <button onClick={uploadPaybleInvoices} className='btn-custom mt-3'>Upload</button>
  </>
  )
}

export default Uploader
