import { companyTitle } from 'functions/companyBranding';
import { jobTypeOptions } from 'functions/terminology';
import axiosClient from "apis/axiosClient";
import openNotification from "Components/Shared/Notification";
import moment from "moment";

function recordsReducer(state, action){
    switch (action.type) {

      case 'toggle': {
        return { ...state, [action.fieldName]: action.payload } 
      }
      case 'set': {
        return { ...state, ...action.payload }
      }
      default: return state 
    }
};

const initialState = {
  load:false,
  visible:false,
  reportType:'viewer',
  to:moment().format("YYYY-MM-DD"),
  from:moment("2023-07-01").format("YYYY-MM-DD"),
  to2:moment().format("YYYY-MM-DD"),
  from2:moment("2023-07-01").format("YYYY-MM-DD"),
  client:'',
  records:[],
  subType:'',
  company:'1',
  operation:'',
  shipStatus:'',
  overseasagent:'',
  jobType:'Sea Export',
  salesrepresentative:'',
  csvData:[],
  clients:[],
  salesRepresentative:[],
  overseas:[],

  totalRevenue:0.00,
  totalCost:0.00,
  totalPnl:0.00,
  totalActual:0.00,
  totalgainLoss:0.00,
  totalAfter:0.00
};

  const companies = [
    {
      value: '1',
      label: 'Seanet Shipping',
    },
    {
      value: '2',
      label: 'Cargo Linkers',
    },
    {
      value: '3',
      label: 'Air Cargo Services',
    }
  ]

  const fetchData = async(set, state) => {
    set({load:true});
    // console.log("Fetching Data with state:", state)
    await axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_MISC_GET_JOB_PROFIT_LOSS,{
      headers:{ ...state }
    }).then(async(x) => {
      let result = x.data.result, totalRevenue=0.00, totalCost=0.00, totalPnl=0.00, totalActual=0.0, totalgainLoss=0.0, totalAfter=0.0;
      // console.log(result)
      if(x.data.status!="success" || x.data.result.length<1){
        openNotification("Error", "No record found with current criteria", "orange");
      } else {
        
        await result.forEach((y) => {
          y.revenue = 0.0;
          y.cost = 0.0;
          y.actual = 0.0;
          y.gainLoss = 0.00;
          y.after = 0.00;
          y.Invoices.forEach((z) => {
            if(z.currency=='PKR'){
              if(z.payType=="Recievable") {
                y.revenue = y.revenue + parseFloat(z.total);  //total will not be multiplied by Ex.Rate
                y.actual = y.actual + parseFloat(z.recieved);  //This will be multiplied by Ex.Rate
                if(z.Invoice_Transactions?.length>0) {
                  z.Invoice_Transactions.forEach((i) => {
                    y.gainLoss = y.gainLoss + parseFloat(i.gainLoss)
                  })
                }
              } else {
                y.cost = y.cost + parseFloat(z.total);  //total will not be multiplied by Ex.Rate
                y.actual = y.actual - parseFloat(z.paid)  //This will be multiplied by Ex.Rate
                if(z.Invoice_Transactions?.length>0){
                  z.Invoice_Transactions.forEach((i)=>{
                    y.gainLoss = y.gainLoss + parseFloat(i.gainLoss)
                  })
                }
              }
            }else{
              if(z.payType=="Recievable") {
                y.revenue = y.revenue + parseFloat(z.total)*parseFloat(z.ex_rate);  //total will not be multiplied by Ex.Rate
                y.actual = y.actual + parseFloat(z.recieved)*parseFloat(z.ex_rate);  //This will be multiplied by Ex.Rate
                if(z.Invoice_Transactions?.length>0) {
                  z.Invoice_Transactions.forEach((i) => {
                    y.gainLoss = y.gainLoss + parseFloat(i.gainLoss)
                  })
                }
              } else {
                y.cost = y.cost + parseFloat(z.total)*parseFloat(z.ex_rate);  //total will not be multiplied by Ex.Rate
                y.actual = y.actual - parseFloat(z.paid)*parseFloat(z.ex_rate)  //This will be multiplied by Ex.Rate
                if(z.Invoice_Transactions?.length>0){
                  z.Invoice_Transactions.forEach((i)=>{
                    y.gainLoss = y.gainLoss + parseFloat(i.gainLoss)
                  })
                }
              }
            }
          })
          // y.gainLoss = y.gainLoss*-1;
          
          y.pnl = y.revenue-y.cost
          totalRevenue  = totalRevenue + y.revenue;
          totalCost     = totalCost + y.cost;
          totalPnl      = totalPnl + y.pnl;
          totalgainLoss = totalgainLoss + y.gainLoss;
          y.after = y.revenue - y.cost + y.gainLoss
          y.actual = y.revenue - y.cost
          // The jobs' P/L added up. It subtracted the running cost total on
          // every job - nothing showed it, but it was never a figure.
          totalActual   = totalActual + y.actual;
          // gainLoss is each invoice's own share of its receipt's or payment's
          // - the server's functions/gainLossShares (2026-11-20).
          totalAfter = totalAfter + y.after
        })
        excelDataFormatter(result, set)
      }
      await set({
        visible:x.data.status=="success"?
          x.data.result.length>0?
            true:false:
          false,
        load:false,
        records:result,
        totalRevenue,
        totalCost,   
        totalPnl,    
        totalActual,
        totalgainLoss,
        totalAfter
      });
      /* A `findGainLoss` loop ran here, and it was most of the report's load
         time. It walked every job with a 300ms pause between each, clearing a
         per-row `load` flag and pushing the whole records array back into
         state - one full re-render per job. Nothing read that flag, and the
         invoice ids it collected were thrown away: it was what was left of a
         per-job gain/loss request that no longer exists. A range of 1,100 jobs
         spent five and a half minutes re-rendering the page for no visible
         change, and re-running the report started a second loop beside the
         first. Gain/loss is already computed above from the transactions the
         query returns. */
    })
  }

  // See functions/terminology: an aviation install also gets 'Aviation'
  // (operation 'AV'), and drops the sea operations it does not run.
  const plainOptions = jobTypeOptions();

  
  const typeOptions = [
    {label:'FCL', value:'FCL'},
    {label:'LCL', value:"LCL"},
    {label:'Air', value:"AIR"},
  ];

  const excelDataFormatter = (records, set) => {
    // console.log("records", records)
    let tempData = [
      ["Sr","Job No","OperationType","VesselName", "Date", "HBL / HAWB", "MBL / MAWB", "Client",
        "SubType", "Shipper","Shipper/Consignee","Sales Rep","OverSeas Agent","Shipping Line", 
        "Local Agent" ,"F. Dest","Teu", "Weight", "Revenue", "Cost","P/L", "Gain/Loss", 
        "After Gain/Loss","CompanyName","Commodity","Packages","POL","Buying Rate","Selling Rate",
        "jobType","Cost Center","Nomination","Unit","Customer Ref","Sailing/Arrival Date","Sailing Date"

      ],
    ];
    for (let index = 0; index < records.length; index++) {
      // Was a hardcoded id->name ladder carrying Seanet's own companies, so
      // this export printed their names on any other client's report. Reads
      // the installation's actual companies instead, falling back to the id.
      let companyName = companyTitle(records[index].companyId, records[index].companyId);
      let data = [
        index+1,
        records[index].jobNo,
        records[index].operation,
        records[index].local_vendor?.name,
        records[index].createdAt ? records[index].createdAt.slice(0, 10) : "",
        records[index].Bl? records[index].Bl.hbl : "",
        records[index].Bl? records[index].Bl.mbl : "",
        records[index].Client.name ? records[index].Client.name : "",
        records[index].subType? records[index].subType: "" ,
        records[index].shipper?.name ?  records[index].shipper.name  :"",
        records[index].consignee?.name ?  records[index].consignee.name  :"",
        records[index].sales_representator?.name ?  records[index].sales_representator.name  :"",
        records[index].shipping_line?.name ?  records[index].shipping_line.name  :"",
        records[index].overseas_agent?.name ?  records[index].overseas_agent.name  :"",
        records[index].local_vendor?.name ?  records[index].local_vendor.name  :"",
        records[index].fd ? records[index].fd : "",
        records[index].SE_Equipments ?records[index].SE_Equipments.teu : "",
        records[index].weight ?records[index].weight : "",
        records[index].revenue ? records[index].revenue.toFixed(2) : "",
        records[index].cost ? records[index].cost.toFixed(2) : "",
        records[index].actual ? records[index].actual.toFixed(2) : "",
        records[index].gainLoss ? records[index].gainLoss.toFixed(2) : "",
        records[index].after ? records[index].after.toFixed(2) : "",
        companyName,
        records[index].commodity?.name?  records[index].commodity.name  :"",
        records[index].pcs? records[index].pcs :"",
        records[index].pol,
        records[index].exRate,
        records[index].exRate,
        records[index].jobType,
        records[index].costCenter,    
        records[index].nomination,
        records[index].pkgUnit,
        records[index].customerRef,  
        records[index].shipDate,          
        
        

            ];
      tempData.push(data);
    }
    set({
      csvData:tempData
    })
  };
  
export { recordsReducer, initialState, companies, fetchData, plainOptions, typeOptions, excelDataFormatter }
