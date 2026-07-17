import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { MockDataProvider } from './contexts/MockDataContext';
import { ToastProvider } from './contexts/ToastContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import InvoiceUpload from './components/InvoiceUpload';
import ApprovalInbox from './components/ApprovalInbox';
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
import InvoiceRepository from './components/InvoiceRepository';
import PurchasingWorkbench from './components/PurchasingWorkbench';
import ProtectedRoute from './components/ProtectedRoute';
import NotFound from './components/NotFound';

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
                    <Dashboard />
                  </ProtectedRoute>
                } />
                <Route path="/dashboard" element={
                  <ProtectedRoute>
                    <Dashboard />
                  </ProtectedRoute>
                } />
                <Route path="/upload" element={
                  <ProtectedRoute>
                    <InvoiceUpload />
                  </ProtectedRoute>
                } />
                <Route path="/approvals" element={
                  <ProtectedRoute>
                    <ApprovalInbox />
                  </ProtectedRoute>
                } />
                <Route path="/exceptions" element={
                  <ProtectedRoute>
                    <ExceptionManager />
                  </ProtectedRoute>
                } />
                <Route path="/payment-batches" element={
                  <ProtectedRoute>
                    <PaymentBatchManager />
                  </ProtectedRoute>
                } />
                <Route path="/reports" element={
                  <ProtectedRoute>
                    <Reports />
                  </ProtectedRoute>
                } />
                <Route path="/accounting-review" element={
                  <ProtectedRoute>
                    <AccountingReview />
                  </ProtectedRoute>
                } />
                <Route path="/vendors" element={
                  <ProtectedRoute>
                    <VendorManagement />
                  </ProtectedRoute>
                } />
                <Route path="/audit-logs" element={
                  <ProtectedRoute>
                    <AuditLog />
                  </ProtectedRoute>
                } />
                <Route path="/extraction-analytics" element={
                  <ProtectedRoute>
                    <ExtractionDashboard />
                  </ProtectedRoute>
                } />
                <Route path="/sla-analytics" element={
                  <ProtectedRoute>
                    <SLAAnalyticsDashboard />
                  </ProtectedRoute>
                } />
                <Route path="/on-hold-queue" element={
                  <ProtectedRoute>
                    <OnHoldQueue />
                  </ProtectedRoute>
                } />
                <Route path="/users" element={
                  <ProtectedRoute>
                    <UserManagement />
                  </ProtectedRoute>
                } />
                <Route path="/settings" element={
                  <ProtectedRoute>
                    <SettingsPage />
                  </ProtectedRoute>
                } />
                <Route path="/repository" element={
                  <ProtectedRoute>
                    <InvoiceRepository />
                  </ProtectedRoute>
                } />
                <Route path="/purchasing-workbench" element={<ProtectedRoute><PurchasingWorkbench /></ProtectedRoute>} />
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
