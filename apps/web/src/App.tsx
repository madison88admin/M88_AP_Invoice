import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Dashboard from './components/Dashboard';
import InvoiceUpload from './components/InvoiceUpload';
import ApprovalInbox from './components/ApprovalInbox';
import ExceptionManager from './components/ExceptionManager';
import PaymentBatchManager from './components/PaymentBatchManager';
import Reports from './components/Reports';
import AccountingReview from './components/AccountingReview';
import VendorManagement from './components/VendorManagement';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/upload" element={<InvoiceUpload />} />
        <Route path="/approvals" element={<ApprovalInbox />} />
        <Route path="/exceptions" element={<ExceptionManager />} />
        <Route path="/payment-batches" element={<PaymentBatchManager />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/accounting-review" element={<AccountingReview />} />
        <Route path="/vendors" element={<VendorManagement />} />
      </Routes>
    </Router>
  );
}

export default App;
