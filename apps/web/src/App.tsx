import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Dashboard from './components/Dashboard';
import InvoiceUpload from './components/InvoiceUpload';
import ApprovalInbox from './components/ApprovalInbox';
import ExceptionManager from './components/ExceptionManager';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/upload" element={<InvoiceUpload />} />
        <Route path="/approvals" element={<ApprovalInbox />} />
        <Route path="/exceptions" element={<ExceptionManager />} />
        <Route path="/payment-batches" element={<PaymentBatchManager />} />
      </Routes>
    </Router>
  );
}

export default App;
