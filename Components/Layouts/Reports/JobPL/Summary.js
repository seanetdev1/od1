import React from 'react';
import PrintTopHeader from '../../../Shared/PrintTopHeader';
import moment from 'moment';
import { Table, Button } from 'antd';
import { render } from 'sass';
import exportExcelFile from 'functions/exportExcelFile';
import { FileExcelOutlined } from '@ant-design/icons';
import { usePageActions } from 'Components/Shared/PageActions';
import { reportCompanyTitle, reportAddress } from 'functions/companyBranding';

const commas = (a) => a == 0 ? '0.00' : parseFloat(a).toFixed(2).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")

const Summary = ({ query, result }) => {

    const columns = [
        {
            title: "Client Name",
            dataIndex: 'clientName',
            key: 'clientName'
        },
        {
            title: 'Revenue',
            dataIndex: 'totalRevenue',
            key: 'totalRevenue',
            render: (text) => <span>{commas(text)}</span>
        },
        {
            title: 'Expense',
            dataIndex: 'totalExpense',
            key: 'totalExpense',
            render: (text) => <span>{commas(text)}</span>
        },
        {
            title: 'PNL',
            dataIndex: 'totalProfitLoss',
            key: 'totalProfitLoss',
            render: (text) => <span style={{ color: text < 0 ? 'red' : 'green' }}>{commas(text)}</span>
        },
        {
            title: 'GP',
            dataIndex: 'GP',
            key: 'GP',
            render: (text) => <span style={{ color: text < 0 ? 'red' : 'green' }}>{commas(text)}</span>
        },
    ]
    
    // Add optional columns if present in the data
    if (result.result.some(item => item.totalVol !== undefined)) {
        columns.push({
            title: 'Total Vol',
            dataIndex: 'totalVol',
            key: 'totalVol',
            render: (text) => <span>{commas(text)}</span>
        });
    }
    if (result.result.some(item => item.totalWeight !== undefined)) {
        columns.push({
            title: 'Total Weight',
            dataIndex: 'totalWeight',
            key: 'totalWeight',
            render: (text) => <span>{commas(text)}</span>
        });
    }
    if (result.result.some(item => item.totalTeu !== undefined)) {
        columns.push({
            title: 'Total TEU',
            dataIndex: 'totalTeu',
            key: 'totalTeu',
            render: (text) => <span>{commas(text)}</span>
        });
    }
    if (result.result.some(item => item.totalShpVol !== undefined)) {
        columns.push({
            title: 'Total Shp Vol',
            dataIndex: 'totalShpVol',
            key: 'totalShpVol',
            render: (text) => <span>{commas(text)}</span>
        });
    }
    const handleExport = () => {
    if (!result?.result || result.result.length === 0) {
        alert('No data available to export');
        return;
    }

    const fromDate = moment(query.from).format("DD-MM-YYYY");
    const toDate = moment(query.to).format("DD-MM-YYYY");

    const flatColumns = columns.map(col => ({
        header: col.title,
        key: col.dataIndex
    }));

    const flatData = result.result.map(item => ({
        ...item,
        totalRevenue: commas(item.totalRevenue),
        totalExpense: commas(item.totalExpense),
        totalProfitLoss: commas(item.totalProfitLoss),
        GP: commas(item.GP),
        totalVol: item.totalVol ? commas(item.totalVol) : "",
        totalWeight: item.totalWeight ? commas(item.totalWeight) : "",
        totalTeu: item.totalTeu ? commas(item.totalTeu) : "",
        totalShpVol: item.totalShpVol ? commas(item.totalShpVol) : "",
    }));

    exportExcelFile(flatData, flatColumns, {
        title:
        reportCompanyTitle(query.company),
        address: reportAddress(query.company),
        dateRange: `Date: From ${fromDate} To ${toDate}`,
        fileName: `Comparative_Report_${fromDate}_${toDate}.xlsx`,
    });
    };
    console.log(result)
    usePageActions({
      title: 'Job P&L — Summary',
      excel: { onClick: handleExport, title: 'Export this summary to Excel' },
    }, []);

    return (
        <div className='base-page-layout' >
            <div style={{ position: 'relative', marginBottom: '20px' }}>
                <PrintTopHeader company={query.company} from={moment(query.from).format("DD-MM-YYYY")} to={moment(query.to).format("DD-MM-YYYY")} />

            </div>
            <Table columns={columns} dataSource={result.result}></Table>
        </div>
    );
};

export default Summary;