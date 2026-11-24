import { DeleteOutlined, DollarOutlined, EditOutlined, PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { Input, InputNumber, Select, DatePicker, Checkbox, Radio } from "antd";
import { usePageActions } from 'Components/Shared/PageActions';
import { incrementTab, removeTabNew } from 'redux/tabs/tabSlice';
import moment from "moment";
import Router from 'next/router';
import { useEffect, useRef, useState } from "react";
import { setDJField, resetDirectJob, updateDirectJobItem, setDefaultType } from 'redux/directJob/directJobSlice';
import { useDispatch, useSelector } from "react-redux";
import openNotification from 'Components/Shared/Notification';
import axios from "axios";
import Cookies from "js-cookie";
import Operation from "antd/lib/transfer/operation";
import axiosClient from 'apis/axiosClient';
import { useReactToPrint } from 'react-to-print';
import DirectJobPrint from './DirectJobPrint';
import { directJobFromSaved, lineAmount } from 'functions/directJobEntry';
import { isCashMode, pickerDate } from 'functions/cashCheque';
import { useDocuments } from 'Components/Shared/Documents';
import { blankLine, linesToSave, withBlankLast, lineHasData, jobFields, linesForJobs, linesPerJob } from 'functions/directJobLines';
import JobNumberInput from './JobNumberInput';
import JobPicker from './JobPicker';

// The currencies a line or the entry can be in, and the container sizes.
const CURRENCIES = ['PKR', 'USD', 'EUR', 'GBP', 'AED', 'OMR', 'BDT', 'CHF'];
const SIZE_TYPES = ['20BK', '20FR', '20OT', '20RE', '20SD', '20TK', '40FR', '40BK', '40HC', '40HCRF', '40OT', '40SD', '40VH', '45BK', '45HC', '45OT', '45TK', '45VH', 'M3'];

const commas = (a) => a == 0 ? '0.00' : parseFloat(a).toFixed(2).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")

const DirectJob = ({ id }) => {

    const state = useSelector((state) => state.directJob);

    // Which entry has been loaded, so it is loaded once - see below.
    const loadedFor = useRef(null);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const res = await axiosClient.get(
                `${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/voucher/getDirectJob`,
                {
                    headers: {
                    id: id   // <-- whatever your ID value is
                    }
                }
                );
                /* All of it through functions/directJobEntry, which does not
                 * throw on a missing value. Read field by field here, an entry
                 * with no Paid To (any migrated without one) stopped loading
                 * halfway and showed the blank-entry defaults with no lines. */
                const { fields, lines } = directJobFromSaved(res.data.result || {});
                dispatch(resetDirectJob());
                Object.entries(fields).forEach(([field, value]) => dispatch(setDJField({ field, value })));
                dispatch(setDJField({ field: "directJob", value: lines }));
            }catch(e){
                console.log(e)
            }
        }

        /* `id != null` was true for the STRING 'new' - the route this screen
         * opens at when creating an entry - so every new Direct Job fetched a
         * row whose id is not a number. There is nothing to load for a new
         * one: the list screen resets the form before navigating here.
         *
         * ONCE PER ENTRY. This was keyed on the charges list as well, and the
         * charges were re-fetched on every keystroke in the job search - so
         * each search reloaded the entry, whose first act is a reset: the
         * picker's results vanished and any unsaved edit was thrown away. */
        if(id != null && !isNaN(parseInt(id, 10)) && loadedFor.current !== String(id)){
            loadedFor.current = String(id);
            fetchData();
        } else if (id == null || isNaN(parseInt(id, 10))) {
            // A new entry: the next existing one opened is loaded afresh.
            loadedFor.current = null;
        }
    }, [id])

    /* What a new entry starts as - revenue or expense, Configuration > Direct
     * Job. Never fatal: unread, a new entry starts as expense, the default. */
    useEffect(() => {
        axiosClient.get('/settings/directJobDefaultType')
            .then(({ data }) => dispatch(setDefaultType(data?.result?.type)))
            .catch(() => {});
    }, [])

    /* NO CONFIRMATION HERE any more - the header's Delete asks before it calls
     * this, the same question in the same dialog as every other screen's. Two
     * confirmations for one press is what a second one here would be. */
    const deleteData = async (id) => {
        try {
            setLoading(true);

            await axiosClient.post(
                `${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/voucher/deleteDirectJob`,
                {}, // body
                { headers: { id: parseInt(id), employeeId: Cookies.get("loginId") } } // the id goes in the headers
            );

            dispatch(resetDirectJob());
            openNotification('Success', `Direct Job Deleted`, 'green');
            setLoading(false);
            dispatch(removeTabNew('3-15')); // just pass the number directly
            await Router.push(`/accounts/directJobList`)
        } catch (e) {
            console.log(e);
            setLoading(false);
            openNotification('Error', e?.response?.data?.message || 'Could not delete this entry.', 'red');
        }
    };


    const [ loading, setLoading ] = useState(false);
    const dispatch = useDispatch();

    /* THE JOB ON A LINE - typed in the line's Job # box, or chosen from the
     * job list that Enter opens there (JobNumberInput, JobPicker; asked
     * 2026-11-13). `index` is the line the list is choosing for, `query`
     * what was typed before Enter. */
    const [ picker, setPicker ] = useState({ open: false, index: 0, query: '' });

    // The jobs numbered exactly what was typed - the server's exact lookup.
    const findJob = async (text) => {
        const res = await axiosClient.get(`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/voucher/getDirectJobNumbers`, {
            params: { search: text, exact: 1, page: 1, limit: 2 },
        });
        return res?.data?.data || [];
    };

    // The job, its number and its file number - on customs, the S/R Page #.
    const pickJob = (index, job) => {
        Object.entries(jobFields(job)).forEach(([field, value]) => dispatch(updateDirectJobItem({ index, field, value })));
    };

    /* SEVERAL JOBS FROM THE JOB LIST'S TICKS (asked 2026-11-17): so many lines
     * for each, put in where the list was opened - see functions/directJobLines
     * linesForJobs. The charges and figures are typed on them afterwards. */
    const pickJobs = (index, jobs, perJob) => {
        const added = jobs.length * linesPerJob(perJob);
        dispatch(setDJField({ field: 'directJob', value: linesForJobs(state.directJob, index, jobs, perJob) }));
        openNotification('Lines added',
            `${added} line${added === 1 ? '' : 's'} for ${jobs.length} job${jobs.length === 1 ? '' : 's'} - fill in their charges.`, 'green');
    };

    const searchJobs = (index, query) => setPicker({ open: true, index, query: query || '' });

    // The lines as they are now - for an answer that lands after more typing.
    const linesRef = useRef(state.directJob);
    linesRef.current = state.directJob;

    /* ONE OF EACH CHARGE PER JOB, when the install has it on (Configuration >
     * Direct Job, asked 2026-11-17). Asked of the server as a charge is
     * picked - the same answer a Save gets, counting the job's other entries
     * - so a repeat is turned back on the line, not found at Save. The old
     * charge is put back and the notice says where it already is. Nothing
     * comes back when the switch is off; a failed check is left to the Save,
     * which checks again. */
    const checkCharge = async (index, charge, previous) => {
        const lines = linesRef.current.map((l, i) => (i === index ? { ...l, Charge: charge } : l));
        const line = lines[index];
        if (!line || !Number(line.JobId) || !charge) return;
        let result;
        try {
            const res = await axiosClient.post(`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/voucher/checkDirectJobCharges`, {
                direct_Job: { id: state.directJob_Id || null, Type: state.directJob_Type },
                direct_Job_Association: linesToSave(lines).map((l) => ({ Job_Id: l.JobId, Job_No: l.JobNumber, Charge_Name: l.Charge })),
            });
            result = res?.data?.result;
        } catch (e) {
            return;
        }
        const hit = (result?.repeats || []).some((r) => String(r.jobId) === String(line.JobId) && String(r.charge) === String(charge));
        // And only if the line still holds the charge that was asked about.
        if (!hit || String(linesRef.current[index]?.Charge) !== String(charge)) return;
        Object.entries(previous).forEach(([field, value]) => dispatch(updateDirectJobItem({ index, field, value })));
        openNotification('Charge already on this job', result.message, 'orange', 10);
    };

    /* A BLANK LINE AT THE BOTTOM, ALWAYS, on a multiple-job entry: typing into
     * the last line adds the next one, so lines are entered without reaching
     * for Add +. It is never saved - see handleSave and functions/
     * directJobLines. A single-job entry is one line and gets none. */
    useEffect(() => {
        if (state.directJob_JobType !== 'multiple') return;
        const lines = withBlankLast(state.directJob);
        if (lines) dispatch(setDJField({ field: 'directJob', value: lines }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.directJob, state.directJob_JobType]);

    // const handleSave = async (edit) => {
    //     try{
    //         let companyId = Cookies.get('companyId')
    //         let user = Cookies.get('username')
    //         console.log("Saving", user)
    //         let direct_Job = {
    //             Entry_No: state.directJob_EntryNumber,
    //             Entry_Date: state.directJob_EntryDate,
    //             Type: state.directJob_Type,
    //             Reference_No: state.directJob_Reference,
    //             Operation: state.directJob_Operation,
    //             Job_Type: state.directJob_JobType,
    //             SubType: state.directJob_SubType,
    //             Cheque_No: state.directJob_ChequeNo,
    //             Cheque_Date: state.directJob_ChequeDate,
    //             Currency: state.directJob_Currency,
    //             Ex_Rate: state.directJob_Currency == 'PKR' ? 1 : state.directJob_JobType == 'single' ? state.directJob[0].ExRate: state.directJob_ExRate,
    //             Tran_Mode: state.directJob_TransMode,
    //             Drawn_At: state.directJob_DrawnAt,
    //             Account_No: state.directJob_Account,
    //             Paid_To: state.directJob_PaidTo,
    //             Paid_Name: state.directJob_PaidTo ? state.directJob_CAccounts.find((x) => x.id == state.directJob_PaidTo).name : '',
    //             Narration: state.directJob_Remarks,
    //             companyId,
    //             Add_By: user,
    //         }
    //         let direct_Job_Association = [];
    //         for(let job of state.directJob){
    //             direct_Job_Association.push({
    //                 Job_No: job.JobNumber,
    //                 File_No: job.FileNumber,
    //                 Charge_Name: job.Charge,
    //                 Basis: job.Basis,
    //                 Rate_Group: job.RateGroup,
    //                 Size_Type: job.SizeType,
    //                 Quantity: job.Quantity,
    //                 Currency: job.Currency,
    //                 Ex_Rate: job.ExRate,
    //                 Amount: job.Rate,
    //                 Discount: job.Discount,
    //                 Tax_Apply: job.TaxApply,
    //                 Tax_Amount: job.TaxAmount,
    //                 VAT_Catagory: job.VATCategory,
    //                 Description: job.Description,
    //                 Job_Id: job.JobId,
    //             })
    //         }
    //         console.log("Direct Job to be saved", { direct_Job, direct_Job_Association })
    //         if(!edit){
    //             const result = axiosClient.post(`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/voucher/createDirectJob`,
    //                 { direct_Job, direct_Job_Association }
    //             ).then((x) => {
    //                 dispatch(setDJField({ field: 'directJob_EntryNumber', value: x.data.result.Entry_Number }));
    //                 dispatch(setDJField({ field: 'directJob_VoucherNumber', value: x.data.result.Voucher_Number }));
    //                 console.log(x.data.result)
    //                 Router.push(`/accounts/directJob/${x.data.result.id}`)
    //                 setLoading(false);
    //             }).catch((e) => {
    //                 console.log(e)
    //                 setLoading(false);
    //                 openNotification('Error', 'Something went wrong', 'red');
    //             });
    //             // Router.push(`/accounts/directJob/${result.data.result.Voucher_Number}`);
    //         }else{
    //             const result = await axiosClient.post(`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/voucher/updateDirectJob`, { direct_Job, direct_Job_Association });

    //         }
    //     }catch(e){
    //         console.log(e)
    //     }
    // }


    const handleSave = async () => {
  /* ONLY THE LINES WITH SOMETHING ON THEM - the blank one at the bottom, and
   * any other left empty, are not sent (functions/directJobLines). An entry
   * with none is refused here, rather than by the server's "Charge_Name
   * cannot be null". */
  const lines = linesToSave(state.directJob);
  if (!lines.length) {
    openNotification('Warning', 'Nothing to save - add a line with a job and a charge first.', 'orange');
    return;
  }
  try {
    setLoading(true);

    const companyId = Cookies.get('companyId');
    const user = Cookies.get('username');

    let direct_Job = {
      Entry_No: state.directJob_EntryNumber,
      Entry_Date: state.directJob_EntryDate,
      Type: state.directJob_Type,
      Reference_No: state.directJob_Reference,
      Operation: state.directJob_Operation,
      Job_Type: state.directJob_JobType,
      SubType: state.directJob_SubType,
      // Cash has no cheque - see functions/cashCheque.
      Cheque_No: isCashMode(state.directJob_TransMode) ? '' : state.directJob_ChequeNo,
      Cheque_Date: isCashMode(state.directJob_TransMode) ? null : state.directJob_ChequeDate,
      Currency: state.directJob_Currency,
      Ex_Rate:
        state.directJob_Currency == 'PKR'
          ? 1
          : state.directJob_JobType == 'single'
          ? lines[0]?.ExRate
          : state.directJob_ExRate,
      Tran_Mode: state.directJob_TransMode,
      Drawn_At: state.directJob_DrawnAt,
      Account_No: state.directJob_Account,
      Paid_To: state.directJob_PaidTo,
      Paid_Name: state.directJob_PaidTo
        ? state.directJob_CAccounts.find((x) => x.id == state.directJob_PaidTo)?.name || ''
        : '',
      Narration: state.directJob_Remarks,
      companyId,
      Add_By: user,
    };

    /* EDIT OR CREATE IS DECIDED BY THE ENTRY IN THE FORM, not the address.
     *
     * It went by the address (`id != 'new'`). After a new entry was saved the
     * tab still said 'new', so going back to it opened /directJob/new with the
     * saved entry still in the form - and Save sent no id: the server made a
     * second entry with a voucher of its own while the screen said "Direct
     * Job Updated" (reported 2026-11-12). The form holds the entry's id from
     * the moment it is loaded or saved, and Clear empties it, so it is the
     * one thing that says which entry is being saved. */
    const existingId = parseInt(state.directJob_Id, 10);
    const isEdit = !isNaN(existingId);
    if (isEdit) {
      direct_Job.id = existingId;
      direct_Job.Voucher_Id = parseInt(state.directJob_VoucherId, 10);
    }

    const direct_Job_Association = lines.map((job) => ({
      Job_No: job.JobNumber,
      File_No: job.FileNumber,
      Charge_Name: job.Charge,
      Basis: job.Basis,
      Rate_Group: job.RateGroup,
      Size_Type: job.SizeType,
      Quantity: job.Quantity,
      Currency: job.Currency,
      Ex_Rate: job.ExRate,
      // The line total, which the voucher posts - not the rate. A line of
      // 2 x 500 posted 500. See functions/directJobEntry.
      Amount: lineAmount(job),
      Discount: job.Discount,
      Tax_Apply: job.TaxApply,
      Tax_Amount: job.TaxAmount,
      VAT_Catagory: job.VATCategory,
      Description: job.Description,
      Job_Id: job.JobId,
    }));

    console.log("API Payload", { direct_Job, direct_Job_Association });

    const result = await axiosClient.post(
      `${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/voucher/saveDirectJob`,
      {
        direct_Job,
        direct_Job_Association,
        fiscalYearId: Cookies.get('fiscalYearId'),
        employeeId: Cookies.get("loginId"),
      }
    );

    console.log("API Response", result.data);

    const savedId = result?.data?.result?.id;

    openNotification(
      'Success',
      isEdit ? 'Direct Job Updated' : 'Direct Job Created',
      'green'
    );

    if (savedId) {
      // And the tab: left on 'new', clicking it later reopened /new - see above.
      dispatch(incrementTab({ label: 'Edit Direct Job E / R', key: '3-15', id: savedId }));
      Router.push(`/accounts/directJob/${savedId}`);
    } else {
      console.warn("ID not returned from API");
    }

    setLoading(false);

  } catch (e) {
  console.log("FULL ERROR:", e);
  console.log("SERVER ERROR:", e?.response?.data);
  
  setLoading(false);
  // Long enough to read a refusal that names where a charge already is.
  openNotification(
    'Error',
    e?.response?.data?.message || 'Something went wrong',
    'red',
    10
  );
}
};

    useEffect(() => {
        console.log("state.directJob", state.directJob)
        let tempAmount = 0.0;
        let tempDiscount = 0.0;
        let tempTaxAmount = 0.0;
        let tempNetAmount = 0.0;
        let tempNetAmountIncTax = 0.0;
        let tempLocalAmount = 0.0;
        for(let job of state.directJob){
            tempAmount += job.Amount;
            tempDiscount += job.Discount;
            tempTaxAmount += job.TaxAmount;
            tempNetAmount += job.NetAmount;
            console.log("Job Net Amount Including Tax: ", job.NetIncTaxAmount)
            tempNetAmountIncTax += job.NetIncTaxAmount || 0;
            tempLocalAmount += job.LocalAmount;
        }
        console.log("Total Net Amount Including Tax: ", tempNetAmountIncTax)
        dispatch(setDJField({ field: 'directJob_TotalAmount', value: tempAmount }));
        dispatch(setDJField({ field: 'directJob_TotalDiscount', value: tempDiscount }));
        dispatch(setDJField({ field: 'directJob_TotalTaxAmount', value: tempTaxAmount }));
        dispatch(setDJField({ field: 'directJob_TotalNetAmount', value: tempNetAmount }));
        dispatch(setDJField({ field: 'directJob_TotalNetAmountIncTax', value: tempNetAmountIncTax }));
        dispatch(setDJField({ field: 'directJob_TotalLocalAmount', value: tempLocalAmount }));
    }, [state.directJob])

    /* The chart of accounts and the charges: once, when the screen opens. They
     * were fetched again on every keystroke in the job search, ahead of the
     * jobs - slow, and each fresh charges list reloaded the open entry. */
    useEffect(() => {
    const getLookups = async () => {
        try {
        const res = await axiosClient.get( process.env.NEXT_PUBLIC_CLIMAX_GET_ALL_CHILD_ACCOUNTS );
            const accounts = res?.data?.result || []; // only update if data exists
            if (accounts.length > 0) {
            dispatch(setDJField({ field: 'directJob_CAccounts', value: accounts }));
        }
        const result = await axiosClient.get( process.env.NEXT_PUBLIC_CLIMAX_GET_ALL_CHARGES );
        const charges = result?.data?.result || []; // only update if data exists
        if (charges.length > 0) {
            dispatch(setDJField({ field: 'directJob_Charges', value: charges }));
        }
        } catch (err) {
        console.error("Failed to fetch accounts and charges", err);
        }
    };
    getLookups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /* The settlement accounts the chosen Tran Mode can post to.
     *
     * KEYED ON THE TRAN MODE, which it was not. This ran once on mount with
     * whatever mode the screen opened in and never again, so switching to
     * Adjustment left the Bank accounts from the first render sitting in the
     * picker - the right list existed on the server (Adjust -> subCategory
     * 'General', see routes/accounts/getAccountsForTransaction) and was simply
     * never asked for.
     *
     * The account already picked is cleared alongside, in the Tran Mode
     * selector's own handler rather than here - this effect also runs on mount,
     * where an edited voucher's saved account has to survive. */
    useEffect(() => {
    const fetchreceivingAccount = async () => {
        try{
        await axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_GET_ACCOUNT_FOR_TRANSACTION, {
            headers: {
            type: state.directJob_TransMode,
            }
        }).then((x) => {
            dispatch(setDJField({ field: 'directJob_SettlementAccounts', value: x.data.result }))
        })
        }catch(e){
        console.log(e)
        }
    }
    fetchreceivingAccount()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.directJob_TransMode])

    /* THE HEADER AND ITS BUTTONS, declared rather than drawn.
     *
     * This screen used to draw its own title row with three unlabelled icon
     * buttons wearing `delete-btn1` / `edit-btn1` - Clear looked exactly like
     * Delete, and Save wore the class called edit. They are the app's standard
     * New / Save / Delete now, in the same three places they sit on every
     * other converted screen.
     *
     * CLEAR IS THE `new` SLOT: on an entry being edited it empties the form to
     * start another one, which is what New means everywhere else. It asks
     * first, because typed lines are lost - the old Warning-triangle button
     * dropped them without a word.
     *
     * Save takes no argument. The old row passed handleSave(true) when there
     * was an entry number and handleSave(false) when there was not; the
     * function has taken no parameter for some time and decides insert from
     * update by the id it was opened with. */
    /* THE PRINT - laid out after the voucher Climax printed for these entries.
     * Rendered off-screen, not display:none: react-to-print copies computed
     * styles, and a hidden ancestor prints a blank page. */
    const printRef = useRef(null);
    const handlePrint = useReactToPrint({
        content: () => printRef.current,
        documentTitle: `Direct Job ${state.directJob_EntryNumber || ''}`,
    });

    // The entry's documents: the paperclip in the toolbar (2026-11-13).
    const docs = useDocuments({
        entity: 'Direct_Job',
        recordId: id == 'new' ? null : state.directJob_Id,
        title: `Documents - Direct Job ${state.directJob_EntryNumber || ''}`,
    });

    usePageActions({
        title: `${id == 'new' ? 'Add' : 'Edit'} Direct Job Expense / Revenue`,
        subtitle: state.directJob_VoucherNumber
            ? `Voucher # ${state.directJob_VoucherNumber}`
            : undefined,
        new: {
            onClick: () => dispatch(resetDirectJob()),
            label: 'Clear',
            title: 'Empty the form and start another entry',
            disabled: loading,
            confirm: 'Clear this entry and start a new one? Anything typed here is lost.',
        },
        save: {
            onClick: () => handleSave(),
            busy: loading,
            label: id == 'new' ? 'Save entry' : 'Save changes',
        },
        print: {
            onClick: () => handlePrint(),
            // An entry number is assigned on save, and the print is the
            // entry - so it prints once there is one.
            disabled: id == 'new' || !state.directJob_EntryNumber,
            title: id == 'new' || !state.directJob_EntryNumber ? 'Save the entry first' : 'Print this entry',
        },
        delete: id != 'new' ? {
            onClick: () => deleteData(state.directJob_Id),
            disabled: loading || !state.directJob_Id,
            confirm: {
                what: 'direct job entry',
                name: state.directJob_EntryNumber,
                body: 'Its voucher and every line on it go with it.',
            },
        } : undefined,
        extras: [docs.extra],
    }, [id, loading, state.directJob_VoucherNumber, state.directJob_Id, state.directJob_EntryNumber, handlePrint, docs.count, docs.saved]);

    /* A LINE'S FIGURES - the one it was given, then the four worked from it:
     * Amount (rate x quantity), Net (less discount), Net Inc Tax (less tax)
     * and Local (at its exchange rate). The same sums each box did on its own,
     * five times over; one place now. */
    const setLineFigure = (index, item, field, value) => {
        const next = { ...item, [field]: value || 0 };
        const quantity = next.Quantity || 0;
        const rate = next.Rate || 0;
        const discount = next.Discount || 0;
        const tax = next.TaxAmount || 0;
        const exRate = next.ExRate || 0;
        const amount = rate * quantity;
        const netAmount = amount - discount;
        const netAmountIncTax = netAmount - tax;
        const local = netAmountIncTax * exRate;
        dispatch(updateDirectJobItem({ index, field, value: value || 0 }));
        dispatch(updateDirectJobItem({ index, field: 'Amount', value: amount }));
        dispatch(updateDirectJobItem({ index, field: 'NetAmount', value: netAmount }));
        dispatch(updateDirectJobItem({ index, field: 'NetIncTaxAmount', value: netAmountIncTax }));
        dispatch(updateDirectJobItem({ index, field: 'LocalAmount', value: local }));
    };
    const single = state.directJob_JobType == 'single';
    const filledLines = state.directJob.filter(lineHasData).length;
    const figure = (v) => (Number(v) ? commas(v) : <span className='djp-zero'>—</span>);

    /* THE ENTRY (2026-11-16 redesign). A card for the entry, one for its
     * totals, its lines in the shared list table (styles/dataList), then its
     * remarks. It was three bootstrap columns of label-over-box pairs at 90%
     * widths, a 3000px table with a rounded blue-grey heading and a round
     * black +, and the totals as six paragraphs in a box. */
    return (
        <div className='base-page-layout djp-screen'>
            {docs.modal}
            <div className='djp-top'>
                {/* THE ENTRY. */}
                <section className='djp-card'>
                    <div className='djp-card-head'>
                        <div>
                            <div className='djp-label'>Entry #</div>
                            <div className='djp-number'>{state.directJob_EntryNumber || <span className='djp-muted'>Given when saved</span>}</div>
                            {state.directJob_VoucherNumber && <div className='djp-hint'>Voucher {state.directJob_VoucherNumber}</div>}
                        </div>
                        <div className='djp-choices'>
                            <div className='djp-field'>
                                <span className='djp-label'>Type *</span>
                                <Radio.Group className='dl-segmented djp-kind' value={state.directJob_Type} onChange={(e) => {dispatch(setDJField({ field: 'directJob_Type', value: e.target.value}))}}>
                                    <Radio.Button value="expense">Expense</Radio.Button>
                                    <Radio.Button value="revenue">Revenue</Radio.Button>
                                </Radio.Group>
                            </div>
                            <div className='djp-field'>
                                <span className='djp-label'>Operation *</span>
                                <Radio.Group className='dl-segmented' value={state.directJob_Operation} onChange={(e) => {dispatch(setDJField({ field: 'directJob_Operation', value: e.target.value}))}}>
                                    <Radio.Button value="logistics">Logistics</Radio.Button>
                                    <Radio.Button value="other">Other</Radio.Button>
                                </Radio.Group>
                            </div>
                            <div className='djp-field'>
                                <span className='djp-label'>Job Type *</span>
                                <Radio.Group className='dl-segmented' value={state.directJob_JobType}
                                    onChange={(ev) => {
                                        const e = ev.target.value;
                                        if (e == 'single') {
                                            const temp = [...state.directJob];
                                            temp.splice(1, temp.length - 1);
                                            dispatch(setDJField({ field: 'directJob', value: temp }))
                                        }else{
                                            dispatch(setDJField({ field: 'directJob_JobId', value: 0 }));
                                            dispatch(setDJField({ field: 'directJob_JobNumber', value: "" }));
                                        }
                                        dispatch(setDJField({ field: 'directJob_JobType', value: e}))
                                    }}>
                                    <Radio.Button value="single">Single</Radio.Button>
                                    <Radio.Button value="multiple">Multiple</Radio.Button>
                                </Radio.Group>
                            </div>
                        </div>
                    </div>

                    <div className='djp-grid'>
                        <div className='djp-field'>
                            <span className='djp-label'>Entry Date *</span>
                            <DatePicker format={'DD-MM-YYYY'} value={moment(state.directJob_EntryDate)} onChange={(e) => {dispatch(setDJField({ field: 'directJob_EntryDate', value: e ? e.toISOString() : null}))}}/>
                        </div>
                        <div className='djp-field djp-span-2'>
                            <span className='djp-label'>Tran Mode *</span>
                            <Radio.Group className='dl-segmented' value={state.directJob_TransMode} onChange={(ev) => {
                                const e = ev.target.value;
                                dispatch(setDJField({ field: 'directJob_TransMode', value: e}));
                                // The account already chosen belongs to the list this
                                // replaces - a Bank account id posted against a General
                                // adjustment is a voucher pointing at the wrong account.
                                // Cleared HERE and not in the fetch effect, because that
                                // also runs on mount, where an edited voucher's saved
                                // account has to survive.
                                dispatch(setDJField({ field: 'directJob_Account', value: undefined}));
                                // Cash has no cheque. Off cash, the date starts at
                                // today again, as a new entry's does.
                                if (isCashMode(e)) {
                                    dispatch(setDJField({ field: 'directJob_ChequeNo', value: ''}));
                                    dispatch(setDJField({ field: 'directJob_ChequeDate', value: null}));
                                } else if (!state.directJob_ChequeDate) {
                                    dispatch(setDJField({ field: 'directJob_ChequeDate', value: moment().toISOString()}));
                                }
                            }}>
                                <Radio.Button value="Bank">Bank</Radio.Button>
                                <Radio.Button value="Cash">Cash</Radio.Button>
                                <Radio.Button value="Adjust">Adjustment</Radio.Button>
                            </Radio.Group>
                        </div>
                        <div className='djp-field'>
                            <span className='djp-label'>SubType *</span>
                            <Select placeholder="SubType" value={state.directJob_SubType} onChange={(e) => {dispatch(setDJField({ field: 'directJob_SubType', value: e}))}}>
                                <Select.Option value="wire transfer">Wire Transfer</Select.Option>
                                <Select.Option value="online transfer">Online Transfer</Select.Option>
                                <Select.Option value="credit card">Credit Card</Select.Option>
                                <Select.Option value="cheque">Cheque</Select.Option>
                                <Select.Option value="po">PO</Select.Option>
                                <Select.Option value="tt">TT</Select.Option>
                                <Select.Option value="cash">Cash</Select.Option>
                                {/* For Tran Mode Adjustment - settled by journal against a
                                    staff IOU or advance account, neither a bank instrument
                                    nor cash. Needs cl-deploy/direct-job-adjustment-subtype.sql
                                    on an existing database. */}
                                <Select.Option value="adjustment">Adjustment</Select.Option>
                            </Select>
                        </div>

                        <div className='djp-field djp-span-2'>
                            <span className='djp-label'>Account # *</span>
                            <Select
                                showSearch
                                optionFilterProp="children"
                                placeholder={state.directJob_SettlementAccounts.length ? 'The bank, cash or adjustment account' : 'Loading accounts…'}
                                disabled={!state.directJob_SettlementAccounts.length}
                                value={state.directJob_SettlementAccounts.length ? state.directJob_Account : undefined}
                                onChange={(value) => {
                                    dispatch(setDJField({ field: 'directJob_Account', value }))
                                }}
                                >
                                {state.directJob_SettlementAccounts.map(item => (
                                    <Select.Option key={item.id} value={item.id}>
                                    {`${item.title} - ${item.code}`}
                                    </Select.Option>
                                ))}
                            </Select>
                        </div>
                        <div className='djp-field djp-span-2'>
                            <span className='djp-label'>Paid to</span>
                            <Select
                                showSearch
                                allowClear
                                optionFilterProp="children"
                                placeholder={state.directJob_CAccounts.length ? 'Paid to…' : 'Loading accounts…'}
                                disabled={!state.directJob_CAccounts.length}
                                value={state.directJob_CAccounts.length ? state.directJob_PaidTo : undefined}
                                onChange={(value) => {
                                    dispatch(setDJField({ field: 'directJob_PaidTo', value }))
                                }}
                                >
                                {state.directJob_CAccounts.map(item => (
                                    <Select.Option key={item.id} value={item.id}>
                                    {`${item.title} - ${item.code}`}
                                    </Select.Option>
                                ))}
                            </Select>
                        </div>

                        <div className='djp-field'>
                            <span className='djp-label'>Reference #</span>
                            <Input placeholder="Reference #" value={state.directJob_Reference} onChange={(e) => {dispatch(setDJField({ field: 'directJob_Reference', value: e.target.value}))}}/>
                        </div>
                        <div className='djp-field'>
                            <span className='djp-label'>Cheque #</span>
                            <Input placeholder="Cheque #" disabled={isCashMode(state.directJob_TransMode)} value={isCashMode(state.directJob_TransMode) ? '' : state.directJob_ChequeNo} onChange={(e) => {dispatch(setDJField({ field: 'directJob_ChequeNo', value: e.target.value}))}}/>
                        </div>
                        <div className='djp-field'>
                            <span className='djp-label'>Cheq Date{isCashMode(state.directJob_TransMode) ? '' : ' *'}</span>
                            <DatePicker format={'DD-MM-YYYY'} disabled={isCashMode(state.directJob_TransMode)} value={isCashMode(state.directJob_TransMode) ? null : pickerDate(state.directJob_ChequeDate)} onChange={(e) => {dispatch(setDJField({ field: 'directJob_ChequeDate', value: e ? e.toISOString() : null}))}}/>
                        </div>
                        <div className='djp-field'>
                            <span className='djp-label'>Drawn At</span>
                            <Input placeholder="Drawn At" value={state.directJob_DrawnAt} onChange={(e) => {dispatch(setDJField({ field: 'directJob_DrawnAt', value: e.target.value}))}}/>
                        </div>

                        <div className='djp-field'>
                            <span className='djp-label'>Currency</span>
                            <Select placeholder="Currency" value={state.directJob_Currency} onChange={(e) => {dispatch(setDJField({ field: 'directJob_Currency', value: e}))}}
                                options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
                        </div>
                        <div className='djp-field'>
                            <span className='djp-label'>Ex-Rate</span>
                            <InputNumber disabled={state.directJob_Currency == 'PKR'} placeholder="Ex-Rate..." value={state.directJob_Currency == 'PKR' ? 1 : single ? state.directJob[0].ExRate: state.directJob_ExRate}
                            onChange={(value) => {
                                if(single){
                                    setLineFigure(0, state.directJob[0], 'ExRate', value);
                                }else{
                                    // Was `value: e` - no `e` here, so typing a rate threw.
                                    dispatch(setDJField({ field: 'directJob_ExRate', value }))
                                }
                            }}/>
                        </div>
                        {/* A single-job entry's job is its one line's - see
                            JobNumberInput. On a multiple-job entry each line
                            carries its own. */}
                        <div className='djp-field'>
                            <span className='djp-label'>Job #</span>
                            <JobNumberInput
                                disabled={!single}
                                value={single ? state.directJob[0]?.JobNumber : ''}
                                findJob={findJob}
                                onPick={(job) => pickJob(0, job)}
                                onSearch={(text) => searchJobs(0, text)}
                            />
                        </div>
                        <div className='djp-field'>
                            <span className='djp-label'>File #</span>
                            {/* The line's file number, as the line's own File # box sets it. */}
                            <Input disabled={!single} placeholder={single ? 'File #' : 'On each line'} value={single ? state.directJob[0]?.FileNumber : ''}
                            onChange={(e) => {
                                dispatch(updateDirectJobItem({ index: 0, field: 'FileNumber', value: e.target.value }))
                                }}/>
                        </div>
                    </div>
                </section>

                {/* ITS TOTALS. */}
                <section className='djp-card djp-totals'>
                    <h3 className='djp-card-title'>Totals</h3>
                    {[
                        ['Total Amount', state.directJob_TotalAmount],
                        ['Discount', state.directJob_TotalDiscount],
                        ['Net Amount', state.directJob_TotalNetAmount],
                        ['Tax Amount', state.directJob_TotalTaxAmount],
                        ['Net Amount Inc Tax', state.directJob_TotalNetAmountIncTax],
                    ].map(([label, value]) => (
                        <div key={label} className='djp-total-row'>
                            <span>{label}</span>
                            <b>{commas(value)}</b>
                        </div>
                    ))}
                    <div className='djp-tile'>
                        <span className='djp-label'>Local Amount</span>
                        <span className='djp-tile-value'>PKR {commas(state.directJob_TotalLocalAmount)}</span>
                    </div>
                </section>
            </div>

            {/* ITS LINES. */}
            <section className='djp-lines'>
                <div className='djp-lines-head'>
                    <h3 className='djp-card-title'>Lines <span className='djp-count'>{filledLines}</span></h3>
                    <button type='button' className='dl-tool djp-add'
                        disabled={single}
                        title={single ? 'A single-job entry is one line - choose Multiple for more' : 'Add a line'}
                        onClick={async () => {
                            const temp = [...state.directJob, blankLine()];
                            await dispatch(setDJField({ field: 'directJob', value: temp }));
                        }}><PlusOutlined /> Line</button>
                </div>
                <div className='djp-lines-table'>
                    <table className='dl-table'>
                        <thead>
                        <tr>
                            <th className='djp-col-n'>#</th>
                            <th>Job #</th>
                            <th>Charges Name</th>
                            <th>File #</th>
                            <th>Basis</th>
                            <th>Currency</th>
                            <th>Rate Group</th>
                            <th>Size Type</th>
                            <th className='dl-num'>Quantity</th>
                            <th className='dl-num'>Rate</th>
                            <th className='dl-num'>Amount</th>
                            <th className='dl-num'>Discount</th>
                            <th className='dl-num'>Net Amount</th>
                            <th>Tax</th>
                            <th className='dl-num'>Tax Amount</th>
                            <th>VAT Category</th>
                            <th className='dl-num'>Net Inc Tax</th>
                            <th className='dl-num'>Ex. Rate</th>
                            <th className='dl-num'>Local Amount</th>
                            <th>Description</th>
                        </tr>
                        </thead>
                        <tbody>
                            {state.directJob.map((item, index) => {
                                const blank = !single && index === state.directJob.length - 1 && !lineHasData(item);
                                return (
                                <tr key={index} className={blank ? 'djp-line-blank' : undefined}>
                                <td className='djp-col-n'>
                                    <span className='djp-n'>{index + 1}</span>
                                    {!blank && (
                                        <button type='button' className='djp-del' tabIndex={-1} title='Remove this line' onClick={() => {
                                            if(state.directJob.length > 1){
                                                const temp = [...state.directJob];
                                                temp.splice(index, 1);
                                                dispatch(setDJField({ field: 'directJob', value: temp }));
                                            }else{
                                                openNotification('Warning', `Cannot remove all items`, 'orange')
                                            }
                                        }}>
                                            <DeleteOutlined />
                                        </button>
                                    )}
                                </td>
                                <td className='djp-w-job'>
                                    <JobNumberInput
                                        value={item.JobNumber}
                                        findJob={findJob}
                                        onPick={(job) => pickJob(index, job)}
                                        onSearch={(text) => searchJobs(index, text)}
                                    />
                                </td>
                                <td className='djp-w-charge'>
                                    <Select
                                    showSearch
                                    optionFilterProp="children"
                                    value={state.directJob_Charges.length ? item.Charge : undefined}
                                    disabled={!state.directJob_Charges.length}
                                    placeholder={state.directJob_Charges.length ? 'Charges Name...' : 'Loading charges…'}
                                    onChange={(value, option) => {
                                        const previous = { Charge: item.Charge, Basis: item.Basis, Currency: item.Currency };
                                        dispatch(updateDirectJobItem({ index, field: 'Charge', value }));
                                        dispatch(updateDirectJobItem({ index, field: 'Basis', value: option.calculationType == 'Per Unit' ? 'unit' : 'shipment' }));
                                        dispatch(updateDirectJobItem({ index, field: 'Currency', value: option.currency }));
                                        checkCharge(index, value, previous);
                                    }}
                                    >
                                    {state.directJob_Charges.map(charge => (
                                        <Select.Option
                                        key={charge.id}
                                        value={charge.id}
                                        calculationType={charge.calculationType}
                                        currency={charge.currency}
                                        >
                                        {`(${charge.code}) - ${charge.name} - ${charge.short}`}
                                        </Select.Option>
                                    ))}
                                    </Select>
                                </td>
                                <td className='djp-w-file'><Input value={item.FileNumber} onChange={(e) => {dispatch(updateDirectJobItem({ index: index, field: 'FileNumber', value: e.target.value}))}} placeholder="File #"/></td>
                                <td className='djp-w-basis'><Select value={item.Basis} onChange={(e) => {dispatch(updateDirectJobItem({ index: index, field: 'Basis', value: e}))}} placeholder="Basis...">
                                        <Select.Option value="unit">Per Unit</Select.Option>
                                        <Select.Option value="shipment">Per Shipment</Select.Option>
                                    </Select></td>
                                <td className='djp-w-cur'><Select value={item.Currency} onChange={(e) => {dispatch(updateDirectJobItem({ index: index, field: 'Currency', value: e}))}} placeholder="Currency..."
                                        options={CURRENCIES.map((c) => ({ value: c, label: c }))} /></td>
                                <td className='djp-w-group'>
                                    <Select value={item.RateGroup} onChange={(e) => {dispatch(updateDirectJobItem({ index: index, field: 'RateGroup', value: e}))}} placeholder="Rate Group...">
                                        <Select.Option value="None">None</Select.Option>
                                        <Select.Option value="Rate1">Rate1</Select.Option>
                                        <Select.Option value="Rate2">Rate2</Select.Option>
                                    </Select>
                                </td>
                                <td className='djp-w-size'>
                                    <Select showSearch value={item.SizeType} onChange={(e) => {dispatch(updateDirectJobItem({ index: index, field: 'SizeType', value: e}))}} placeholder="Size Type"
                                        options={SIZE_TYPES.map((s) => ({ value: s, label: s }))} />
                                </td>
                                <td className='djp-w-num'><InputNumber value={item.Quantity === 0 ? null : item.Quantity} placeholder="Qty"
                                    onChange={(value) => setLineFigure(index, item, 'Quantity', value)} /></td>
                                <td className='djp-w-num'><InputNumber value={item.Rate === 0 ? null : item.Rate} placeholder="Rate"
                                    onChange={(value) => setLineFigure(index, item, 'Rate', value)} /></td>
                                <td className='dl-num djp-out'>{figure(item.Amount)}</td>
                                <td className='djp-w-num'><InputNumber value={item.Discount == 0 ? null : item.Discount} placeholder="Discount"
                                    onChange={(value) => setLineFigure(index, item, 'Discount', value)} /></td>
                                <td className='dl-num djp-out'>{figure(item.NetAmount)}</td>
                                <td className='djp-col-tax'>
                                    <Checkbox checked={item.TaxApply} onChange={(e) => {dispatch(updateDirectJobItem({ index: index, field: 'TaxApply', value: e.target.checked}))}} />
                                </td>
                                <td className='djp-w-num'><InputNumber disabled={!item.TaxApply} value={item.TaxAmount == 0 ? null : item.TaxAmount} placeholder="Tax"
                                    onChange={(value) => setLineFigure(index, item, 'TaxAmount', value)} /></td>
                                <td className='djp-w-num'><InputNumber value={item.VATCategory} onChange={(e) => {dispatch(updateDirectJobItem({ index: index, field: 'VATCategory', value: e}))}} placeholder="VAT"/></td>
                                <td className='dl-num djp-out'>{figure(item.NetIncTaxAmount)}</td>
                                <td className='djp-w-num'><InputNumber disabled={item.Currency == 'PKR'} value={item.ExRate == 0 ? '' : item.ExRate} placeholder="Rate"
                                    onChange={(value) => setLineFigure(index, item, 'ExRate', value)} /></td>
                                <td className='dl-num djp-out djp-local'>{figure(item.LocalAmount)}</td>
                                <td className='djp-w-desc'><Input value={item.Description} onChange={(e) => {dispatch(updateDirectJobItem({ index: index, field: 'Description', value: e.target.value}))}} placeholder="Description"/></td>
                            </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* ITS REMARKS. */}
            <section className='djp-card djp-remarks'>
                <h3 className='djp-card-title'>Remarks</h3>
                <Input.TextArea value={state.directJob_Remarks} onChange={(e) => {dispatch(setDJField({ field: 'directJob_Remarks', value: e.target.value}))}} name="Remarks" rows={3} placeholder="Remarks..." />
            </section>

            <JobPicker
                open={picker.open}
                initialQuery={picker.query}
                // Ticks for several jobs at once on a multiple-job entry only -
                // a single-job entry is one line.
                multiple={!single}
                onPick={(job) => {
                    pickJob(picker.index, job);
                    setPicker({ open: false, index: 0, query: '' });
                }}
                onPickMany={(jobs, perJob) => {
                    pickJobs(picker.index, jobs, perJob);
                    setPicker({ open: false, index: 0, query: '' });
                }}
                onCancel={() => setPicker({ open: false, index: 0, query: '' })}
            />
            {/* The print, off-screen - see handlePrint. */}
            <div aria-hidden='true' style={{ position: 'absolute', left: '-10000px', top: 0, width: '210mm' }}>
                <div ref={printRef}>
                    <DirectJobPrint state={state} companyId={Cookies.get('companyId')} />
                </div>
            </div>
        </div>
    );
};

export default DirectJob
