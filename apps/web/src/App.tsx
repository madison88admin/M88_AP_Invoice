import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { MockDataProvider } from './contexts/MockDataContext';
import { ToastProvider } from './contexts/ToastContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import InvoiceUpload from './components/InvoiceUpload';
import ApprovalInbox from './components/ApprovalInbox';
import ApprovedInvoices from './components/ApprovedInvoices';
import ReturnedInvoices from './components/ReturnedInvoices';
import ExceptionManager from './components/ExceptionManager';
import PaymentBatchManager from './components/PaymentBatchManager';
import Reports from './components/Reports';
import AccountingReview from './components/AccountingReview';
import VendorManagement from './components/VendorManagement';
import AuditLog from './components/AuditLog';
import ExtractionDashboard from './components/ExtractionDashboard';
import SLAAnalyticsDashboard from './components/SLAAnalyticsDashboard';
import OnHoldQueue from './components/OnHoldQueue';
import UserManagement from './components/UserManagement';
import SettingsPage from './components/SettingsPage';
import BankDetailsMasterlist from './components/BankDetailsMasterlist';
import FinanceControlsDashboard from './components/FinanceControlsDashboard';
import AccountingInvoiceArchive from './components/AccountingInvoiceArchive';

import ProtectedRoute from './components/ProtectedRoute';
import NotFound from './components/NotFound';
import AppLayout from './components/AppLayout';
import { FileText, CheckSquare, AlertTriangle, Building2, Package, BarChart3, FileSearch, Users, Settings, Upload, FileSearch as AuditIcon, LayoutDashboard, Landmark, CheckCircle, XCircle, RotateCcw, Clock3 } from 'lucide-react';
import ValidationPendingQueue from './components/ValidationPendingQueue';

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <MockDataProvider>
          <ToastProvider>
            <Router>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/" element={
                  <ProtectedRoute>
                    <AppLayout title="Dashboard" icon={<div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-violet))' }}><LayoutDashboard className="h-5 w-5 text-white" strokeWidth={1.75} /></div>}>
                      <Dashboard />
                    </AppLayout>
                  </ProtectedRoute>
                } />
                <Route path="/dashboard" element={
                  <ProtectedRoute>
                    <AppLayout title="Dashboard" icon={<div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-violet))' }}><LayoutDashboard className="h-5 w-5 text-white" strokeWidth={1.75} /></div>}>
                      <Dashboard />
                    </AppLayout>
                  </ProtectedRoute>
                } />
                <Route path="/upload" element={
                  <ProtectedRoute>
                    <AppLayout title="Upload Invoice" icon={<div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-violet))' }}><Upload className="h-5 w-5 text-white" strokeWidth={1.75} /></div>}>
                      <InvoiceUpload />
                    </AppLayout>
                  </ProtectedRoute>
                } />
                <Route path="/approvals" element={
                  <ProtectedRoute>
                    <AppLayout title="Approval Inbox" icon={<div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-violet))' }}><CheckSquare className="h-5 w-5 text-white" strokeWidth={1.75} /></div>}>
                      <ApprovalInbox />
                    </AppLayout>
                  </ProtectedRoute>
                } />
                <Route path="/approved-invoices" element={
                  <ProtectedRoute>
                    <AppLayout title="Approved Invoices" icon={<div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-lime), var(--accent-green))' }}><CheckCircle className="h-5 w-5 text-white" strokeWidth={1.75} /></div>}>
                      <ApprovedInvoices />
                    </AppLayout>
                  </ProtectedRoute>
                } />
                <Route path="/validation-pending" element={
                  <ProtectedRoute roles={['PURCHASING_COORDINATOR', 'PURCHASING_MANAGER', 'IT_ADMIN']}>
                    <AppLayout title="Pending Coordinator" icon={<div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-purple))' }}><Clock3 className="h-5 w-5 text-white" strokeWidth={1.75} /></div>}>
                      <ValidationPendingQueue />
                    </AppLayout>
                  </ProtectedRoute>
                } />
                <Route path="/returned-invoices" element={
                  <ProtectedRoute>
                    <AppLayout title="Returned Invoices" icon={<div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-amber), var(--accent-red))' }}><RotateCcw className="h-5 w-5 text-white" strokeWidth={1.75} /></div>}>
                      <ReturnedInvoices />
                    </AppLayout>
                  </ProtectedRoute>
                } />
                <Route path="/exceptions" element={
                  <ProtectedRoute>
                    <AppLayout title="Exception Manager" icon={<div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-violet))' }}><AlertTriangle className="h-5 w-5 text-white" strokeWidth={1.75} /></div>}>
                      <ExceptionManager />
                    </AppLayout>
                  </ProtectedRoute>
                } />
                <Route path="/payment-batches" element={
                  <ProtectedRoute>
                    <AppLayout title="Payment Batches" icon={<div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-violet))' }}><Package className="h-5 w-5 text-white" strokeWidth={1.75} /></div>}>
                      <PaymentBatchManager />
                    </AppLayout>
                  </ProtectedRoute>
                } />
                <Route path="/reports" element={
                  <ProtectedRoute>
                    <AppLayout title="Reports" icon={<div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-violet))' }}><BarChart3 className="h-5 w-5 text-white" strokeWidth={1.75} /></div>}>
                      <Reports />
                    </AppLayout>
                  </ProtectedRoute>
                } />
                <Route path="/accounting-review" element={
                  <ProtectedRoute>
                    <AppLayout title="Accounting Review" icon={<div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-violet))' }}><FileSearch className="h-5 w-5 text-white" strokeWidth={1.75} /></div>}>
                      <AccountingReview />
                    </AppLayout>
                  </ProtectedRoute>
                } />
                <Route path="/cancelled-payment-batches" element={
                  <ProtectedRoute>
                    <AppLayout title="Cancelled Payment Batches" icon={<div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-red), var(--accent-amber))' }}><XCircle className="h-5 w-5 text-white" strokeWidth={1.75} /></div>}>
                      <PaymentBatchManager initialTab="cancelled" />
                    </AppLayout>
                  </ProtectedRoute>
                } />
                <Route path="/accounting-approved-invoices" element={
                  <ProtectedRoute roles={['ACCOUNTING_ASSOCIATE', 'ACCOUNTING_SUPERVISOR', 'IT_ADMIN']}>
                    <AppLayout title="Approved Invoices" icon={<div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-lime), var(--accent-green))' }}><CheckCircle className="h-5 w-5 text-white" /></div>}>
                      <AccountingInvoiceArchive mode="approved" />
                    </AppLayout>
                  </ProtectedRoute>
                } />
                <Route path="/accounting-rejected-invoices" element={
                  <ProtectedRoute roles={['ACCOUNTING_ASSOCIATE', 'ACCOUNTING_SUPERVISOR', 'IT_ADMIN']}>
                    <AppLayout title="Rejected Invoices" icon={<div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-red), var(--accent-amber))' }}><AlertTriangle className="h-5 w-5 text-white" /></div>}>
                      <AccountingInvoiceArchive mode="rejected" />
                    </AppLayout>
                  </ProtectedRoute>
                } />
                <Route path="/vendors" element={
                  <ProtectedRoute>
                    <AppLayout title="Vendor Management" icon={<div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-violet))' }}><Building2 className="h-5 w-5 text-white" strokeWidth={1.75} /></div>}>
                      <VendorManagement />
                    </AppLayout>
                  </ProtectedRoute>
                } />
                <Route path="/audit-logs" element={
                  <ProtectedRoute>
                    <AppLayout title="Audit Logs" icon={<div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-violet))' }}><AuditIcon className="h-5 w-5 text-white" strokeWidth={1.75} /></div>}>
                      <AuditLog />
                    </AppLayout>
                  </ProtectedRoute>
                } />
                <Route path="/extraction-analytics" element={
                  <ProtectedRoute>
                    <AppLayout title="Extraction Analytics" icon={<div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-violet))' }}><FileText className="h-5 w-5 text-white" strokeWidth={1.75} /></div>}>
                      <ExtractionDashboard />
                    </AppLayout>
                  </ProtectedRoute>
                } />
                <Route path="/sla-analytics" element={
                  <ProtectedRoute>
                    <AppLayout title="SLA Analytics" icon={<div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-violet))' }}><BarChart3 className="h-5 w-5 text-white" strokeWidth={1.75} /></div>}>
                      <SLAAnalyticsDashboard />
                    </AppLayout>
                  </ProtectedRoute>
                } />
                <Route path="/on-hold-queue" element={
                  <ProtectedRoute>
                    <AppLayout title="On-Hold Queue" icon={<div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-violet))' }}><AlertTriangle className="h-5 w-5 text-white" strokeWidth={1.75} /></div>}>
                      <OnHoldQueue />
                    </AppLayout>
                  </ProtectedRoute>
                } />
                <Route path="/users" element={
                  <ProtectedRoute>
                    <AppLayout title="User Management" icon={<div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-violet))' }}><Users className="h-5 w-5 text-white" strokeWidth={1.75} /></div>}>
                      <UserManagement />
                    </AppLayout>
                  </ProtectedRoute>
                } />
                <Route path="/settings" element={
                  <ProtectedRoute>
                    <AppLayout title="System Configuration" icon={<div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-violet))' }}><Settings className="h-5 w-5 text-white" strokeWidth={1.75} /></div>}>
                      <SettingsPage />
                    </AppLayout>
                  </ProtectedRoute>
                } />
                <Route path="/repository" element={
                  <ProtectedRoute>
                    <AppLayout title="Invoice Repository" icon={<div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-violet))' }}><FileText className="h-5 w-5 text-white" strokeWidth={1.75} /></div>}>
                      <Dashboard mode="repository" />
                    </AppLayout>
                  </ProtectedRoute>
                } />
                <Route path="/bank-details" element={
                  <ProtectedRoute>
                    <AppLayout title="Bank Details Masterlist" icon={<div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-purple))' }}><Landmark className="h-5 w-5 text-white" strokeWidth={1.75} /></div>}>
                      <BankDetailsMasterlist />
                    </AppLayout>
                  </ProtectedRoute>
                } />
                <Route path="/finance-controls" element={
                  <ProtectedRoute>
                    <AppLayout title="Finance Controls" icon={<div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-purple))' }}><AlertTriangle className="h-5 w-5 text-white" /></div>}>
                      <FinanceControlsDashboard />
                    </AppLayout>
                  </ProtectedRoute>
                } />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Router>
          </ToastProvider>
        </MockDataProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
