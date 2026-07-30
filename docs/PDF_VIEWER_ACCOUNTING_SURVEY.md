# Accounting Team Survey: Invoice PDF Viewer Feature

**Purpose:** We're adding a feature to store and display original invoice PDFs in the system. We need your input on how you want to view, search, and interact with these PDFs. Your answers will guide the design.

**Background:** Currently, when invoices arrive via email or SFTP, the system extracts data via OCR but does NOT store the original PDF file. This means you cannot view or download the original invoice document from the system. We want to change that.

---

## Section 1: How Do You Want to View the PDF?

**Q1. When you click on an invoice, how do you want to see the PDF?**

- [ ] **A. Inline viewer** — PDF opens inside the system in a popup/modal (no leaving the page)
- [ ] **B. New browser tab** — PDF opens in a separate browser tab
- [ ] **C. Download only** — PDF downloads directly to your computer, no in-system viewer
- [ ] **D. Both viewer + download** — Popup viewer with a "Download" button inside it
- [ ] **E. Other:** ______________________________

**Q2. Where in the system do you want the PDF to be accessible?** (Select all that apply)

- [ ] **A. Invoice table/list** — A "View PDF" button/icon on each row
- [ ] **B. Invoice detail panel** — A "View PDF" button when viewing a single invoice's full details
- [ ] **C. Approval screen** — When approving an invoice, show the PDF so approvers can verify
- [ ] **D. Exception manager** — When resolving exceptions, show the PDF for reference
- [ ] **E. Payment batch** — Show PDF when reviewing invoices in a payment batch
- [ ] **F. Search results** — PDF icon next to each search result
- [ ] **G. Other:** ______________________________

---

## Section 2: Multi-Invoice PDFs (Split Invoices)

**Background:** Sometimes a single PDF file contains multiple invoices (e.g., a supplier sends 3 invoices in one PDF). The system automatically detects and splits these into separate invoice records. Each split becomes its own invoice in the system.

**Q3. For multi-invoice PDFs that were split, how do you want to view them?**

- [ ] **A. Each split invoice gets its own separate PDF** — When you click "View PDF" on invoice part 1, you see only the pages for invoice part 1. Same for part 2, part 3, etc. (Each split is stored independently)
- [ ] **B. All splits link to the original full PDF** — When you click "View PDF" on any split, you see the entire original PDF (all invoices together)
- [ ] **C. Each split gets its own PDF, but also show a link to the original full PDF** — You can view the specific split OR the original complete document
- [ ] **D. Other:** ______________________________

**Q4. When a PDF is split into multiple invoices, do you want to see which part number it is?**

- [ ] **A. Yes** — Show "Part 1 of 3", "Part 2 of 3", etc. in the invoice details
- [ ] **B. No** — Just show each invoice independently, no part numbering
- [ ] **C. Other:** ______________________________

**Q5. If you're viewing a split invoice PDF and need to see the full original, what should happen?**

- [ ] **A. Show a "View Original Full PDF" link/button next to the split PDF viewer**
- [ ] **B. Automatically show both the split and a link to the original**
- [ ] **C. Don't need access to the original — the split is enough**
- [ ] **D. Other:** ______________________________

---

## Section 3: Search & Filter

**Q6. Do you want to be able to filter invoices by whether a PDF is available?**

- [ ] **A. Yes** — Add a filter option: "Has PDF" / "No PDF" / "All"
- [ ] **B. No** — Just show a PDF icon/button on invoices that have one, no filter needed
- [ ] **C. Other:** ______________________________

**Q7. When searching for invoices, what PDF-related info do you want to see in the results?** (Select all that apply)

- [ ] **A. PDF icon** — Small icon indicating a PDF is available
- [ ] **B. Original file name** — Show the original email attachment name (e.g., "PT_BSN_INV_811272.pdf")
- [ ] **C. File size** — Show the PDF file size (e.g., "245 KB")
- [ ] **D. Upload date** — When the PDF was received/stored
- [ ] **E. Source** — Whether it came from email, SFTP, or manual upload
- [ ] **F. None of the above — just a button to view/download**
- [ ] **G. Other:** ______________________________

**Q8. Do you want to search within PDF content (full-text search)?**

- [ ] **A. Yes** — I want to search for text inside the PDFs (e.g., search "invoice number 811272" and find the matching PDF)
- [ ] **B. No** — Searching invoice metadata (vendor, amount, date, status) is enough
- [ ] **C. Maybe later** — Not needed now but would be nice in the future
- [ ] **D. Other:** ______________________________

---

## Section 4: Existing Invoices Without PDFs

**Background:** There are existing invoices in the system that were processed before this feature. These invoices do NOT have stored PDFs.

**Q9. For existing invoices that don't have a stored PDF, what should happen?**

- [ ] **A. Show a disabled/greyed-out "No PDF" button** — Clear indication that no PDF is available
- [ ] **B. Show an "Upload PDF" button** — Allow accounting to manually upload a PDF for old invoices
- [ ] **C. Hide the PDF button entirely** — If no PDF, don't show anything
- [ ] **D. Both A and B** — Greyed out by default, but allow manual upload
- [ ] **E. Other:** ______________________________

**Q10. If we allow manual PDF upload for old invoices, who should be able to do it?**

- [ ] **A. Accounting Associate only**
- [ ] **B. Accounting Associate + Supervisor**
- [ ] **C. All roles with invoice access**
- [ ] **D. IT Admin only**
- [ ] **E. Other:** ______________________________

---

## Section 5: PDF Viewer Features

**Q11. What features do you need in the PDF viewer?** (Select all that apply)

- [ ] **A. Zoom in/out** — Ability to zoom into the PDF
- [ ] **B. Page navigation** — Go to specific page, next/previous page
- [ ] **C. Download button** — Save the PDF to your computer
- [ ] **D. Print button** — Print the PDF directly from the viewer
- [ ] **E. Rotate** — Rotate the page (for scanned documents that are sideways)
- [ ] **F. Fullscreen** — Open the PDF in fullscreen mode
- [ ] **G. Search within PDF** — Find text within the current PDF
- [ ] **H. Thumbnail view** — Show page thumbnails sidebar
- [ ] **I. Other:** ______________________________

**Q12. What size should the PDF viewer be?**

- [ ] **A. Small popup** — Takes up about 50% of the screen
- [ ] **B. Large popup** — Takes up about 80% of the screen
- [ ] **C. Full screen** — Covers the entire screen
- [ ] **D. Side panel** — Opens as a side panel next to the invoice details (split view)
- [ ] **E. Other:** ______________________________

---

## Section 6: Permissions & Access

**Q13. Who should be able to view invoice PDFs?**

- [ ] **A. Everyone with system access** — All roles can view PDFs
- [ ] **B. Accounting only** — Only Accounting Associate and Supervisor
- [ ] **C. Accounting + Approvers** — Accounting plus anyone in the approval chain
- [ ] **D. Role-based** — Same permissions as viewing the invoice itself
- [ ] **E. Other:** ______________________________

**Q14. Should there be an audit log when someone views or downloads a PDF?**

- [ ] **A. Yes, log both view and download** — Track every time someone opens or downloads a PDF
- [ ] **B. Log downloads only** — Only track when someone downloads, not views
- [ ] **C. No logging needed** — Don't track PDF access
- [ ] **D. Other:** ______________________________

---

## Section 7: Additional Questions

**Q15. Are there any invoice types or sources where you DON'T want the PDF stored?**

- [ ] **A. No** — Store PDFs for all invoices regardless of type or source
- [ ] **B. Yes** — Specifically: ______________________________
- [ ] **C. Other:** ______________________________

**Q16. How long should PDFs be retained in the system?**

- [ ] **A. Indefinitely** — Keep all PDFs forever
- [ ] **B. 1 year** — Delete PDFs after 1 year
- [ ] **C. 3 years** — Delete PDFs after 3 years
- [ ] **D. 7 years** — Delete PDFs after 7 years (standard accounting retention)
- [ ] **E. Other:** ______________________________

**Q17. Do you want to be able to compare the original PDF side-by-side with the OCR-extracted data?**

- [ ] **A. Yes** — Show PDF on one side, extracted data fields on the other, so I can verify OCR accuracy
- [ ] **B. No** — Just show the PDF, I'll compare manually if needed
- [ ] **C. Only during OCR review** — Side-by-side only when reviewing/correcting OCR results
- [ ] **D. Other:** ______________________________

**Q18. Any other features or concerns about the PDF viewer that we should know about?**

__________________________________________________________________________

__________________________________________________________________________

__________________________________________________________________________

---

## How to Submit

Please fill out this survey and return it to the IT/Development team. Your answers will directly shape how the PDF viewer feature is built.

**Deadline:** ______________________________

**Contact for questions:** ______________________________

---

*Thank you for your input! — IT/Development Team*
