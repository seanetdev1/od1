import { useWatch } from "react-hook-form";
import { CloseCircleOutlined, RightCircleOutlined, SyncOutlined } from '@ant-design/icons';
import SelectSearchComp from "Components/Shared/Form//SelectSearchComp";
import InputNumComp from "Components/Shared/Form/InputNumComp";
import { Select, Modal, Tag, InputNumber, Checkbox } from 'antd';
import { getVendors, getClients } from '../states';
import SelectComp from "Components/Shared/Form/SelectComp";
import { Row, Col, Table, Spinner } from 'react-bootstrap';
import PopConfirm from 'Components/Shared/PopConfirm';
import React, { useEffect, useState } from 'react';
import PartySearch from './PartySearch';
import { saveHeads, calculateChargeHeadsTotal, makeInvoice, getHeadsNew, approveHeads, autoInvoice } from "../states";
import { v4 as uuidv4 } from 'uuid';
import openNotification from 'Components/Shared/Notification';
import { checkEditAccess } from "functions/checkEditAccess";
import InputNumberComp from "../../../../Shared/Form/InputNumberComp";
import { delay } from "functions/delay";
import { startingQty } from "functions/freightChargeQty";
import { startingSize, chargeSizeOptions } from "functions/equipmentSizes";
import { alreadyInvoicedMessage } from "functions/alreadyInvoiced";
import { AuditTip } from 'Components/Shared/AuditStamp';
import { foreignRateProblem, rateFor, refreshUsdRates } from 'functions/chargeExRate';



// readOnly / canApprove: the user's rights on job charges (functions/
// myPermissions) - viewing a job's charges is not changing them (the user's
// request, 2026-10-10). The server refuses what this does not offer.
const ChargesList = ({state, dispatch, type, append, reset, fields, chargeList, remove, control, setValue, register, companyId, operationType, allValues, chargesData, chargesLoading, readOnly = false, canApprove = true, canRaise = true, canEditInvoiced = true}) => {

  const { permissions } = state;
  // Locked: no right to change charges; on an approved invoice; or on an
  // unapproved one without the right to edit invoices (functions/jobDocRights).
  const permissionAssign = (perm, x) => readOnly || x.Invoice?.approved=="1" || (Boolean(x.InvoiceId) && !canEditInvoiced);
  const [generate, setGenerate] = useState(false);
  const [InvoiceBuffer, setInvoiceBuffer] = useState(false);

  const commas = (a) =>  { return parseFloat(a).toFixed(2).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ", ")};

  useEffect(() => {
    if(chargeList){
      let list = chargeList.filter((x)=>x.check);
      dispatch({
        type:'set', payload:{
        selection:{
          InvoiceId:list.length>0?list[0].InvoiceId:null,
          partyId:list.length>0? list[0].partyId:null
        }}
      })
    }
    chargeList?.length>0?calculate1():null
  }, [chargeList]);

  const calculate  = () => {
    let tempChargeList = [...chargeList];
    for(let i = 0; i<tempChargeList.length; i++){
      if(tempChargeList[i].charge!=""){
        let amount = tempChargeList[i].amount*tempChargeList[i].rate_charge - tempChargeList[i].discount;
        let tax = 0.00;
        if(tempChargeList[i].tax_apply==true){
          tax = (amount/100.00) * tempChargeList[i].taxPerc;
          tempChargeList[i].tax_amount = tax;
          tempChargeList[i].net_amount =( amount + tax ) * parseFloat(tempChargeList[i].qty);
        } else {
          tempChargeList[i].net_amount = (amount * parseFloat(tempChargeList[i].qty));
        }
        if(tempChargeList[i].currency=="PKR"){
          tempChargeList[i].local_amount = (tempChargeList[i].net_amount*1.00);
        } else {
          tempChargeList[i].local_amount = (tempChargeList[i].net_amount*tempChargeList[i].ex_rate);
        }
      }
    }
    let tempChargeHeadsArray = calculateChargeHeadsTotal(tempChargeList, 'full');
    dispatch({type:'set', payload:{...tempChargeHeadsArray}})
    reset({ chargeList: tempChargeList });
  };
  const calculate1  = () => {
    let tempChargeList = [...chargeList];
    for(let i = 0; i<tempChargeList.length; i++){
      if(tempChargeList[i].charge!=""){
        let amount = tempChargeList[i].amount*tempChargeList[i].rate_charge - tempChargeList[i].discount;
        let tax = 0.00;
        if(tempChargeList[i].tax_apply==true){
          tax = (amount/100.00) * tempChargeList[i].taxPerc;
          tempChargeList[i].tax_amount = tax;
          tempChargeList[i].net_amount =( amount + tax ) * parseFloat(tempChargeList[i].qty);
        } else {
          tempChargeList[i].net_amount = (amount * parseFloat(tempChargeList[i].qty)).toFixed(2);
        }
        if(tempChargeList[i].currency=="PKR"){
          tempChargeList[i].local_amount = (tempChargeList[i].net_amount*1.00).toFixed(2);
        } else {
          tempChargeList[i].local_amount = (tempChargeList[i].net_amount*tempChargeList[i].ex_rate).toFixed(2);
        }
      }
    }
    let tempChargeHeadsArray = calculateChargeHeadsTotal(tempChargeList, 'full');
    dispatch({type:'set', payload:{...tempChargeHeadsArray}})
    // reset({ chargeList: tempChargeList });
  };
    
  const saveCharges = async () => {
    if(!state.chargeLoad){
      // A USD (any foreign) charge still open needs a rate above 1 - the
      // server refuses it too (functions/chargeExRate).
      const rateProblem = foreignRateProblem(chargeList);
      if (rateProblem) { openNotification('Error', rateProblem, 'red'); return; }
      await calculate()
      await dispatch({type:'toggle', fieldName:'chargeLoad', payload:true})
      await saveHeads(chargeList, state, dispatch, reset);
      //chargesData.refetch();
    }
  };
  const approveCharges = async () => {
    if(!state.chargeLoad){
      let charges = []
      chargeList.forEach((x) => {
        if(x.check){
          charges.push(x)
        }
      });
      await calculate()
      await dispatch({type:'toggle', fieldName:'chargeLoad', payload:true})
      await approveHeads(charges, state, dispatch, reset);
      //chargesData.refetch();
    }
  };

  // Ex.Rate USD's Edit ExRate - the two rates are locked until it is ticked.
  const [editRates, setEditRates] = useState(false);

  /* REFRESH USD EX-RATE - the job's selling rate on every unapproved USD
     receivable, its buying rate on every unapproved USD payable, each line's
     local amount worked out again; then saved. Approved lines, and lines on
     an approved invoice, keep the rate they were posted at. */
  const refreshRates = async () => {
    if (state.chargeLoad) return;
    const rates = { selling: state.exRate, buying: state.exRateBuying };
    if (!(parseFloat(rates.selling) > 1) || !(parseFloat(rates.buying || rates.selling) > 1)) {
      openNotification('Error', 'Set the Selling and Buying rates above 1 first (tick Edit ExRate).', 'red');
      return;
    }
    const { lines, changed } = refreshUsdRates(chargeList, rates);
    if (!changed) {
      openNotification('Success', 'Every unapproved USD charge already has these rates.', 'green');
      return;
    }
    const totals = calculateChargeHeadsTotal(lines, 'full');
    dispatch({ type: 'set', payload: { ...totals } });
    reset({ chargeList: lines });
    await dispatch({ type: 'toggle', fieldName: 'chargeLoad', payload: true });
    await saveHeads(lines, state, dispatch, reset);
    openNotification('Success', `${changed} USD charge${changed === 1 ? '' : 's'} set to the job's rates and saved.`, 'green');
  };

  const appendCharge = ()=>{
    if(!state.chargeLoad){
    append({
      type:type, description:'', basis:'', key_id:uuidv4(),
      // The job's USD rate for this side: selling on a receivable, buying on a payable.
      new:true,  ex_rate: rateFor(type, { selling: state.exRate, buying: state.exRateBuying }), pp_cc:'PP', 
      // The job's container size, from Equipment Info - see functions/equipmentSizes.
      local_amount: 0,  size_type: startingSize(state.equipments), dg_type:state.selectedRecord.dg=="Mix"?"DG":state.selectedRecord.dg, 
      qty:1, rate_charge:1, currency:'USD', amount:1, check: false, bill_invoice: '', charge: 0, particular: '',
      discount:0, tax_apply:false, taxPerc:0.00, tax_amount:0, net_amount:0, invoiceType:"", name: "", 
      partyId:"", sep:false, status:'0', approved_by:'', approval_date:'', InvoiceId:null, 
      SEJobId:state.selectedRecord.id
    })}
  };

  useEffect(() => {
    let allCheckedAreStatusOne = true;
    let anyChecked = false;
  
    chargeList?.forEach((x) => {
      if (x.check === true) {
        anyChecked = true;
        if (x.status !== '1') {
          allCheckedAreStatusOne = false;
        }
      }
    });
  
    if (anyChecked && allCheckedAreStatusOne) {
      setGenerate(true);
    } else {
      setGenerate(false);
    }
  }, [chargeList]);

  let invoicetemp = false
  

  const generateInvoice = async () => {
    calculate()
    if (!state.chargeLoad) {
      dispatch({ type: 'toggle', fieldName: 'chargeLoad', payload: true });
      let abc = false;
      let charges = [];
  
      chargeList?.forEach(x => {
        if (x.check === true) {
          if (x.status !== '1') {
            abc = false;
            // return; // Exit the loop early if any checked item is not approved
          } else {
            abc = true;
            charges.push(x);
          }
        }
      });
      // Check if `charges` contains items and `abc` is true
      if (charges.length > 0 && abc) {
        await makeInvoice(charges, companyId, reset, operationType, dispatch, state);
      } else {
        dispatch({ type: 'toggle', fieldName: 'chargeLoad', payload: false });
        openNotification('Error', `No Charge Selected!`, 'red');
      }
    }
  };
  
  /* Which ticked lines each document button takes.
   *
   * By party type, as always - plus, for a Job Invoice / Job Bill, a line that
   * has NO party type on its side. Migrated lines Climax never billed came
   * across with none, so Auto Bill skipped every one of them; the server now
   * works out their document the way the charge sheet does (receivable -> Job
   * Invoice, payable -> Job Bill). An agent document still needs 'agent'. */
  const pickFor = (wanted, side) => (chargeList || []).filter((x) => x.check
    && (wanted.includes(x.partyType) || (side && !x.partyType && x.type === side)));

  /* WHY A DOCUMENT BUTTON DID NOTHING, said out loud. They act only when every
   * ticked line is approved, and that refusal was entirely silent - the
   * button simply did nothing, which is how this was reported. */
  const explainRefusal = (label) => {
    const ticked = (chargeList || []).filter((x) => x.check === true);
    if (!ticked.length) {
      openNotification('Error', 'Tick the charges to put on the ' + label + ' first.', 'red');
      return;
    }
    const unapproved = ticked.filter((x) => x.status !== '1');
    if (unapproved.length) {
      openNotification('Error', unapproved.length + ' of the ticked charge(s) are not approved. '
        + 'Approve them first - the Approve/Unapprove button below the charges shows once the job is approved.', 'red');
      return;
    }
    openNotification('Error', 'None of the ticked charges can go on a ' + label + ' - check the party on each line.', 'red');
  };

  /* A ticked line already on an invoice stops the document - see
   * functions/alreadyInvoiced. True when it refused. */
  const refuseIfInvoiced = (list) => {
    const message = alreadyInvoicedMessage(list);
    if (!message) return false;
    openNotification('Error', message, 'red');
    return true;
  };

  /* THE DOCUMENT BUTTONS FOLLOW THE RAISE RIGHT, apart from changing the
     charges (the user's request, 2026-10-20): someone may raise invoices from
     approved charges without editing them, or edit charges without raising. */
  const autoButtons = canRaise ? (<>
      <div className='div-btn-custom-green fl-right py-1 px-3 mx-1' style={{cursor: !generate? "not-allowed" : "pointer"}} onClick={async ()=>{
        if(!generate && !InvoiceBuffer){ explainRefusal('invoice'); return; }
        if(generate && !InvoiceBuffer){
          setInvoiceBuffer(true)
          await delay(500)
          let temp = pickFor(['client'], 'Recievable')
          if(temp.length==0){
            setInvoiceBuffer(false)
            explainRefusal('invoice');
          }else if(refuseIfInvoiced(temp)){
            setInvoiceBuffer(false)
          }else{
            // alert("Auto Invoice Called")
            console.log(allValues)
            await autoInvoice(temp, companyId, reset, operationType, dispatch, state, setInvoiceBuffer, allValues.shipDate, allValues.departureDate).then(()=>{
            });
          }
        }
      }}>Auto Invoice</div>
      <div className='div-btn-custom-green fl-right py-1 px-3 mx-1' style={{cursor: !generate? "not-allowed" : "pointer"}} onClick={async ()=>{
        if(!generate && !InvoiceBuffer){ explainRefusal('bill'); return; }
        if(generate && !InvoiceBuffer){
          setInvoiceBuffer(true)
          await delay(500)
          let temp = pickFor(['vendor', 'vendors'], 'Payble')
          if(temp.length==0){
            setInvoiceBuffer(false)
            explainRefusal('bill');
          }else if(refuseIfInvoiced(temp)){
            setInvoiceBuffer(false)
          }else{
            await autoInvoice(temp, companyId, reset, operationType, dispatch, state, setInvoiceBuffer, allValues.shipDate, allValues.departureDate);
          }
        }
      }}>Auto Bill</div>
      <div className='div-btn-custom-green fl-right py-1 px-3 mx-1' style={{cursor: !generate? "not-allowed" : "pointer"}} onClick={async ()=>{
        if(!generate && !InvoiceBuffer){ explainRefusal('agent invoice'); return; }
        if(generate && !InvoiceBuffer){
          setInvoiceBuffer(true)
          await delay(500)
          let temp = pickFor(['agent'], null)
          if(temp.length==0){
            setInvoiceBuffer(false)
            explainRefusal('agent invoice');
          }else if(refuseIfInvoiced(temp)){
            setInvoiceBuffer(false)
          }else{
            await autoInvoice(temp, companyId, reset, operationType, dispatch, state, setInvoiceBuffer, allValues.shipDate, allValues.departureDate);
          }
        }
      }}>Auto Agent Invoice</div>
  </>) : null;

  return(
  <>
    <Row>
    {readOnly ? (
    <Col>
      <span className='grey-txt' style={{ fontSize: 13 }}>View only - your access does not include changing a job&apos;s charges.</span>
      {autoButtons}
    </Col>
    ) : (<>
    <Col style={{maxWidth:150}}>
      <div className='div-btn-custom text-center py-1 fw-8' onClick={appendCharge}>Add +</div>
    </Col>
    <Col>
      <div className='div-btn-custom mx-2 py-1 px-3 fl-right' onClick={saveCharges}>Save Charges</div>
      {/* <div className='div-btn-custom-green fl-right py-1 px-3' style={{cursor: !generate? "not-allowed" : "pointer"}} onClick={()=>{
        if(generate){
          generateInvoice();
        }
      }}>Generate Invoice No</div> */}
      {autoButtons}
      {/* EX.RATE USD - the job's Selling and Buying rates, as Climax kept
          them (the user's request, 2026-10-13). Locked until Edit ExRate is
          ticked. Refresh puts them on every USD charge still open to change -
          selling on a receivable, buying on a payable - and saves. */}
      <div className='charge-rates' style={{float:'right', display:'flex', alignItems:'center', gap:6, border:'1px solid #d9d9d9', borderRadius:6, padding:'2px 8px', marginRight:8, background:'#fafafa', fontSize:12}}>
        <Checkbox checked={editRates} onChange={(e)=>setEditRates(e.target.checked)}>Edit ExRate</Checkbox>
        <b className='ms-2'>Ex.Rate USD:</b>
        <span>Selling:</span>
        <InputNumber size='small' min={0} step={0.000001} precision={6} style={{width:105}} disabled={!editRates}
          value={state.exRate} onChange={(e)=>dispatch({type:'toggle',fieldName:'exRate',payload:e})}
          aria-label='Selling rate' />
        <span>Buying:</span>
        <InputNumber size='small' min={0} step={0.000001} precision={6} style={{width:105}} disabled={!editRates}
          value={state.exRateBuying} onChange={(e)=>dispatch({type:'toggle',fieldName:'exRateBuying',payload:e})}
          aria-label='Buying rate' />
        <button type='button' onClick={refreshRates} disabled={state.chargeLoad}
          title='Refresh USD Ex-Rate to all unapproved USD charges'
          aria-label='Refresh USD Ex-Rate to all unapproved USD charges'
          style={{border:'none', background:'#1D6F42', color:'#fff', borderRadius:4, padding:'2px 7px', cursor:'pointer', lineHeight:1}}>
          <SyncOutlined />
        </button>
      </div>
    </Col>
    </>)}
    </Row>
    {/* As tall as the window allows (it was 300px, about eight lines - the
        user, 2026-11-02), never less than it was - but ending above the
        window's foot by enough for Calculate and Approve/Unapprove under it.
        100vh - 320px ran into them, and over the Receivable / Payable totals
        below the tab (a user's screenshot, 2026-11-04). */}
    <div className='table-sm-1 mt-3' style={{maxHeight:'max(300px, calc(100vh - 400px))', overflowY:'auto'}}>
    {!state.chargeLoad && !chargesLoading &&
    <Table className='tableFixHead' bordered>
      <thead>
        <tr className='table-heading-center'>
      <th>x</th>
      <th>Sr.</th>
      <th>
        <input type="checkbox" onChange={(e)=>{
          chargeList.forEach((x, i)=>{
            !x.invoice_id&&x.type==type?setValue(`chargeList.${i}.check`, e.target.checked):null
          })
        }} />
      </th>
      <th>Bill/Invoice</th>
      <th>Charge</th>
      <th>Particular</th>
      <th>Party</th>
      <th>Basis</th>
      <th>PP/CC</th>
      {(operationType=="SE"||operationType=="SI") &&<th>SizeType</th>}
      {(operationType=="SE"||operationType=="SI") &&<th style={{minWidth:95}}>DG Type</th>}
      <th>Qty/Wt</th>
      {(operationType=="AI"||operationType=="AE")&&<th>Rate</th>}
      <th>Currency</th>
      {(operationType == "SE" || operationType == "SI") && <th>Amount</th>}
      <th>Discount</th>
      <th style={{minWidth:60}}>Tax</th>
      <th style={{minWidth:100}}>Tax Amount</th>
      <th style={{minWidth:100}}>Net Amount</th>
      <th>Ex.Rate</th>
      <th style={{minWidth:110}}>Local Amount</th>
      <th>Status</th>
      <th style={{minWidth:110}}>Approved By</th>
      <th style={{minWidth:120}}>Approval Date</th>
      {/* Who entered the line and who last changed it - on hover. */}
      <th title='Who entered each line, and who last changed it'></th>
        </tr>
      </thead>
      {chargeList && <tbody>
      {(() => { let sr = 0; return fields.map((x, index) => {
      if (x.type !== type) return null;
      // Numbered within this side (receivable or payable), as shown.
      sr += 1;
      return (
          <tr key={x.key_id || index} className='f table-row-center-singleLine'>
          <td className='text-center'>{/* Remove Charge */}
            <CloseCircleOutlined className='cross-icon' style={{ position: 'relative', bottom: 3 }}
                onClick={() => {
                if((x.Invoice==null || x.Invoice?.status==null || x.Invoice?.approved=="0")) {
                    PopConfirm("Confirmation", "Are You Sure To Remove This Charge?",
                    () => {
                        let tempState = [...chargeList];
                        let tempDeleteList = [...state.deleteList];
                        tempDeleteList.push(tempState[index].id);
                        tempState.splice(index, 1);
                        reset({ chargeList: tempState });
                        dispatch({ type: 'toggle', fieldName: 'deleteList', payload: tempDeleteList });
                })}else{
                    openNotification('Error', `Cannot Remove Approved Charge!`, 'red');}
              }}
            />
          </td>
          <td className='text-center'>{sr}</td>
          <td style={{ backgroundColor: x.status === "1" ? "#DAF7A6" : "white" }} className='text-center'>
            {(x.invoice_id==null && x.new!=true) &&
            <input type="checkbox" {...register(`chargeList.${index}.check`)}
              style={{ cursor: 'pointer' }}
              disabled={
                x.partyId==state.selection.partyId?
                  false:
                  state.selection.partyId==null?
                    false:
                    true
              }
            />}
          </td>
          <td className='text-center'>{/* Invoice Number */}
          {x.invoice_id != null &&
            <Tag color={x.Invoice?.approved === "1" ? "geekblue" : "red"} style={{ fontSize:15, cursor:"pointer" }}
              onClick={()=>dispatch({type:'set',payload:{selectedInvoice:x.invoice_id,tabState:"5"}})}
            >
              {x.invoice_id}
            </Tag>
          }
          </td>
          <td style={{ padding: 3, minWidth: 100 }}> {/* charge selection */}
            <Select className='table-dropdown' showSearch value={parseInt(x.charge)} style={{ paddingLeft: 0 }}
              disabled={permissionAssign(permissions, x)}
              onChange={async (e) => {
                let tempChargeList = [...chargeList];
                let check = tempChargeList[index].charge ? true : false;
                const y = state.fields.chargeList.find((y) => y.id == e);
                if (!y) return;
                tempChargeList[index] = {
                  ...tempChargeList[index],
                  charge: y.id,
                  particular: y.name,
                  basis: y.calculationType,
                  taxPerc: y.taxApply == "Yes" ? parseFloat(y.taxPerc) : 0.00,
                  // P/Unit: Bill Vol on a sea job, CWT (Client) on an air one.
                  qty: startingQty(y.calculationType, operationType, allValues)
                }
                let partyType = "";
                let choiceArr = ['', 'defaultRecivableParty', 'defaultPaybleParty'];// 0=null, 1=recivable, 2=payble
                partyType = y[choiceArr[parseInt(state.chargesTab)]];
                let searchPartyId;
                switch (partyType) {
                    case "Client":
                      searchPartyId = state.selectedRecord.ClientId;
                    break;
                    case "Local-Agent":
                      searchPartyId = state.selectedRecord.localVendorId;
                    break;
                    case "Custom-Agent":
                      searchPartyId = state.selectedRecord.customAgentId;
                    break;
                    case "Transport-Agent":
                      searchPartyId = state.selectedRecord.transporterId;
                    break;
                    case "Forwarding-Agent":
                      searchPartyId = state.selectedRecord.forwarderId;
                    break;
                    case "Overseas-Agent":
                      searchPartyId = state.selectedRecord.overseasAgentId;
                    break;
                    case "Shipping-Line":
                      searchPartyId = state.selectedRecord.shippingLineId;
                    break;
                    default:
                      searchPartyId = state.selectedRecord.localVendorId;
                    break;
                }
                let partyData = [];
                try {
                  partyData = searchPartyId ? await getClients(searchPartyId) : [];
                } catch (err) {
                  partyData = [];
                }
                if (!partyData || partyData.length === 0) {
                  openNotification('Error', `No default ${partyType || ''} party is set on this job for this charge. Charge type applied, please select a party manually.`, 'red');
                  reset({ chargeList: tempChargeList });
                  return;
                }
                if (state.chargesTab == '1') {
                  tempChargeList[index].invoiceType = partyData[0].types.includes("Overseas Agent") ? "Agent Invoice" : "Job Invoice";
                } else {
                  tempChargeList[index].invoiceType =  partyData[0].types.includes("Overseas Agent") ? "Agent Bill" : "Job Bill";
                }
                if(!check){
                  tempChargeList[index].name = partyData[0].name;
                  tempChargeList[index].partyId = partyData[0].id;
                  tempChargeList[index].partyType = partyType == "Client" ? "client" : "vendor";
                }
                reset({ chargeList: tempChargeList })
              }}
              optionFilterProp="children"
              filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
              options={state.fields.chargeList}
            />
          </td>
          <td>{x.particular}</td>
          <td className='text-center'>{/* Party Selection */}
          {/* Open unless the line is on an APPROVED invoice - the rule every
              other field on the line follows (permissionAssign). It used to
              close as soon as the line had an invoice number at all, so
              un-approving the invoice unlocked everything but the party. */}
          {!permissionAssign(permissions, x) &&
            <RightCircleOutlined style={{ position: 'relative', bottom: 3 }}
              onClick={() => dispatch({ type:'set', payload: { headIndex: index, headVisible: true }})}
            />
          }
          {x.name != "" ? <span className='m-2 '><Tag color="geekblue" style={{ fontSize: 15 }}>{x.name}</Tag></span> : ""}
          </td>
          <td>{x.basis=="Per Shipment"?'P/Shp':'P/Unit'} {/* Basis */}
          </td>
          <td style={{ padding: 3, minWidth: 50 }}> {/* PP?CC */}
          {/* <SelectComp register={register} name={`chargeList.${index}.pp_cc`} 
            control={control} width={60} font={13} 
            disabled={permissionAssign(permissions, x)}
            options={[
              { id: 'PP', name: 'PP' },
              { id: 'CC', name: 'CC' }
            ]}
          /> */}
          <Select className='table-dropdown' showSearch value={x.pp_cc} style={{ paddingLeft: 0 }}
              disabled={permissionAssign(permissions, x)}
              onChange={async (e) => {
                let tempChargeList = [...chargeList];
                tempChargeList[index].pp_cc = e
                let searchPartyId;
                if(e == 'PP'){
                  if(type != 'Recievable'){
                    searchPartyId = state.selectedRecord.localVendorId
                  }else{
                    searchPartyId = state.selectedRecord.ClientId
                  }
                }else{
                  searchPartyId = state.selectedRecord.overseasAgentId
                }
                let partyData = [];
                try {
                  partyData = searchPartyId ? await getClients(searchPartyId) : [];
                } catch (err) {
                  partyData = [];
                }
                if (!partyData || partyData.length === 0) {
                  openNotification('Error', `No default party is set on this job for ${e}. PP/CC applied, please select a party manually.`, 'red');
                  reset({ chargeList: tempChargeList });
                  return;
                }
                if (state.chargesTab == '1') {
                  tempChargeList[index].invoiceType = partyData[0].types.includes("Overseas Agent") ? "Agent Invoice" : "Job Invoice";
                } else {
                  tempChargeList[index].invoiceType = partyData[0].types.includes("Overseas Agent") ? "Agent Bill" : "Job Bill";
                }
                tempChargeList[index].name = partyData[0].name;
                tempChargeList[index].partyId = partyData[0].id;
                tempChargeList[index].partyType = e == "PP" ? "client" : "agent";
                reset({ chargeList: tempChargeList })
              }}
              optionFilterProp="children"
              filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
              options={[
                {id: 'PP', value: 'PP', name: 'PP'},
                {id: 'CC', value: 'CC', name: 'CC'}
              ]}
            />
          </td>
          {(operationType=="SE"||operationType=="SI") &&<td style={{ padding: 3 }}> {/* Size/Type */}
          <SelectSearchComp register={register} name={`chargeList.${index}.size_type`} control={control} width={100} font={13} 
            disabled={permissionAssign(permissions, x)}
            options={chargeSizeOptions(state.equipments, x.size_type)}
          />
          </td>
          }
          {(operationType=="SE"||operationType=="SI") &&
          <td style={{ padding: 3 }}> {/* DG */}
          <SelectSearchComp register={register} name={`chargeList.${index}.dg_type`} control={control} width={95} font={13} disabled={permissions?.admin?false:x.InvoiceId!=null?true:false}
            options={[
              { id: 'DG', name: 'DG' },
              { id: 'non-DG', name: 'non-DG' }
            ]}
          />
          </td>
          }
          <td style={{ padding: 3 }}>{/* QTY */}
          <div style={{border:chargeList[index]?.qty==0?'2px solid red':'silver'}}>
          <InputNumberComp register={register} name={`chargeList.${index}.qty`} control={control} label='' width={20} 
            disabled={permissionAssign(permissions, x)} onChange={(e)=>{
              let tempChargeList = [...chargeList];
              tempChargeList[index].qty = e;
              let amount = tempChargeList[index].amount*tempChargeList[index].rate_charge - tempChargeList[index].discount;
              let tax = 0.00;
              if(tempChargeList[index].tax_apply==true){
                tax = (amount/100.00) * tempChargeList[index].taxPerc;
                tempChargeList[index].tax_amount = tax;
                tempChargeList[index].net_amount =( amount + tax ) * parseFloat(e);
              } else {
                tempChargeList[index].net_amount = (amount * parseFloat(e)).toFixed(2);
              }
              if(tempChargeList[index].currency=="PKR"){
                tempChargeList[index].local_amount = (tempChargeList[index].net_amount*1.00).toFixed(2);
              } else {
                tempChargeList[index].local_amount = (tempChargeList[index].net_amount*tempChargeList[index].ex_rate).toFixed(2);
              }
              let tempChargeHeadsArray = calculateChargeHeadsTotal(tempChargeList, 'full');
              dispatch({type:'set', payload:{...tempChargeHeadsArray}})
              reset({ chargeList: tempChargeList });
            }}
          />
          </div>
          </td> 
          {(operationType=="AI"||operationType=="AE") &&<td style={{ padding: 3 }}>{/* rate_charge */}
          <InputNumberComp register={register} name={`chargeList.${index}.rate_charge`} control={control} label='' width={20} 
            disabled={!(operationType=="AI"||operationType=="AE")?true:permissionAssign(permissions, x)} onChange={(e)=>{
              let tempChargeList = [...chargeList];
              tempChargeList[index].rate_charge = e;
              let amount = e*tempChargeList[index].amount - tempChargeList[index].discount;
              let tax = 0.00;
              if(tempChargeList[index].tax_apply==true){
                tax = (amount/100.00) * tempChargeList[index].taxPerc;
                tempChargeList[index].tax_amount = tax;
                tempChargeList[index].net_amount =( amount + tax ) * parseFloat(tempChargeList[index].qty);
              } else {
                tempChargeList[index].net_amount = (amount * parseFloat(tempChargeList[index].qty)).toFixed(2);
              }
              if(tempChargeList[index].currency=="PKR"){
                tempChargeList[index].local_amount = (tempChargeList[index].net_amount*1.00).toFixed(2);
              } else {
                tempChargeList[index].local_amount = (tempChargeList[index].net_amount*tempChargeList[index].ex_rate).toFixed(2);
              }
              let tempChargeHeadsArray = calculateChargeHeadsTotal(tempChargeList, 'full');
              dispatch({type:'set', payload:{...tempChargeHeadsArray}})
              reset({ chargeList: tempChargeList });
            }}
          />
          </td> }
          <td style={{ padding: 3 }} > {/* Currency */}
          <SelectSearchComp register={register} name={`chargeList.${index}.currency`} control={control} width={100} font={13} 
            disabled={permissionAssign(permissions, x)}
            options={[
              { id:"PKR", name:"PKR"},
              { id:"USD", name:"USD"},
              { id:"EUR", name:"EUR"},
              { id:"GBP", name:"GBP"},
              { id:"AED", name:"AED"},             
              { id:"OMR", name:"OMR"},
              { id:"BDT", name:"BDT"},             
              { id:"CHF", name:"CHF"},
            ]}
          />
          </td>
          {(operationType == "SE" || operationType == "SI") && <td style={{ padding: 3 }}> {/* Amount */}
          <InputNumberComp register={register} name={`chargeList.${index}.amount`} control={control} label='' width={20} 
            disabled={(operationType=="AI"||operationType=="AE")?true:permissionAssign(permissions, x)} onChange={(e)=>{
              let tempChargeList = [...chargeList];
              tempChargeList[index].amount = e;
              let amount = e*tempChargeList[index].rate_charge - tempChargeList[index].discount;
              let tax = 0.00;
              if(tempChargeList[index].tax_apply==true){
                tax = (amount/100.00) * tempChargeList[index].taxPerc;
                tempChargeList[index].tax_amount = tax;
                tempChargeList[index].net_amount =( amount + tax ) * parseFloat(tempChargeList[index].qty);
              } else {
                tempChargeList[index].net_amount = (amount * parseFloat(tempChargeList[index].qty)).toFixed(2);
              }
              if(tempChargeList[index].currency=="PKR"){
                tempChargeList[index].local_amount = (tempChargeList[index].net_amount*1.00).toFixed(2);
              } else {
                tempChargeList[index].local_amount = (tempChargeList[index].net_amount*tempChargeList[index].ex_rate).toFixed(2);
              }
              let tempChargeHeadsArray = calculateChargeHeadsTotal(tempChargeList, 'full');
              dispatch({type:'set', payload:{...tempChargeHeadsArray}})
              reset({ chargeList: tempChargeList });
            }}
          />
          </td>}
          <td style={{ padding: 3 }}>  {/* Discount */}
          <InputNumberComp register={register} name={`chargeList.${index}.discount`} control={control} width={30} font={13} 
            disabled={permissionAssign(permissions, x)} onChange={(e)=>{
              let tempChargeList = [...chargeList];
              tempChargeList[index].discount = e;
              let amount = tempChargeList[index].amount*tempChargeList[index].rate_charge - e;
              let tax = 0.00;
              if(tempChargeList[index].tax_apply==true){
                tax = (amount/100.00) * tempChargeList[index].taxPerc;
                tempChargeList[index].tax_amount = tax;
                tempChargeList[index].net_amount =( amount + tax ) * parseFloat(tempChargeList[index].qty);
              } else {
                tempChargeList[index].net_amount = (amount * parseFloat(tempChargeList[index].qty)).toFixed(2);
              }
              if(tempChargeList[index].currency=="PKR"){
                tempChargeList[index].local_amount = (tempChargeList[index].net_amount*1.00).toFixed(2);
              } else {
                tempChargeList[index].local_amount = (tempChargeList[index].net_amount*tempChargeList[index].ex_rate).toFixed(2);
              }
              let tempChargeHeadsArray = calculateChargeHeadsTotal(tempChargeList, 'full');
              dispatch({type:'set', payload:{...tempChargeHeadsArray}})
              reset({ chargeList: tempChargeList });
            }}
          />
          </td>
          <td style={{ textAlign: 'center' }}> {/* Tax Apply */}
          <input type="checkbox" {...register(`chargeList.${index}.tax_apply`)} style={{ cursor: 'pointer' }} 
            disabled={permissionAssign(permissions, x)} 
          />
          </td>
          <td>{x.tax_amount}</td> {/* Tax Amount */}
          <td>{commas(parseFloat(x.net_amount).toFixed(2))}</td>
          <td style={{ padding: 3 }}> {/* Ex. Rate */}
          {chargeList[index]?.currency!="PKR" && 
            <InputNumberComp register={register} name={`chargeList.${index}.ex_rate`}  control={control} label='' width={10} 
            disabled={permissionAssign(permissions, x)}  onChange={(e)=>{
                let tempChargeList = [...chargeList];
                tempChargeList[index].ex_rate = e;
                if(tempChargeList[index].currency=="PKR"){
                  tempChargeList[index].local_amount = (tempChargeList[index].net_amount*1.00).toFixed(2);
                } else {
                  tempChargeList[index].local_amount = (tempChargeList[index].net_amount*tempChargeList[index].ex_rate).toFixed(2);
                }
                let tempChargeHeadsArray = calculateChargeHeadsTotal(tempChargeList, 'full');
                dispatch({type:'set', payload:{...tempChargeHeadsArray}})
                reset({ chargeList: tempChargeList });
            }}
          />
          }
          {chargeList[index]?.currency=="PKR" && <InputNumber value={1.00} />}
          </td>
          <td>{commas(parseFloat(x.local_amount).toFixed(2))}</td>
          <td>{x.status === '1' ? 'Approved' : 'Unapproved'}</td>
          <td></td>
          <td></td>
          <td className='text-center'><AuditTip record={x} /></td>
          </tr>
      )}); })()}
      {!fields.some(x => x.type === type) &&
        <tr>
          <td colSpan={26} style={{textAlign:"center", padding:"3%", color:"grey"}}>
            No charges found for this job.
          </td>
        </tr>
      }
      </tbody>}
    </Table>
    }
    {(state.chargeLoad || chargesLoading) &&
      <div style={{textAlign:"center", paddingTop:'5%', paddingBottom:"5%"}}>
        <Spinner/>
        <div className='grey-txt mt-2'>Loading charges...</div>
      </div>
    }
    <Modal
      open={state.headVisible}
      onOk={()=>dispatch({type:'toggle', fieldName:'headVisible', payload:false})} 
      onCancel={()=>dispatch({type:'toggle', fieldName:'headVisible', payload:false})}
      width={1000} footer={false} maskClosable={false}
    >
      {state.headVisible && <PartySearch state={state} dispatch={dispatch} reset={reset} useWatch={useWatch} control={control} />}
    </Modal>
    </div>
    {(canApprove && allValues.approved.length>0) && <div className='div-btn-custom-green text-center py-1 px-3 mt-3 mx-2' style={{float:'right'}} onClick={()=>{approveCharges(chargeList)}}>Approve/Unapprove</div>}
    {!readOnly && <div className='div-btn-custom-green text-center py-1 px-3 mt-3' style={{float:'right'}} onClick={()=>{calculate(chargeList)}}>Calculate</div>}
    {/* The buttons float; this keeps their height in the tab, so what comes
        after the tab starts below them rather than under them. */}
    <div className='charges-buttons-end' style={{clear:'both'}} />
  </>
  )
}

export default React.memo(ChargesList)
