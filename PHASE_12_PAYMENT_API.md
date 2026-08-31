# Phase 12 — Payment API

เอกสารนี้อธิบาย Backend ของระบบชำระเงินสำหรับ Admin และ Parent

## 1. ขอบเขตที่ยืนยันแล้ว

- Admin สร้างรายการเรียกเก็บเงิน
- รายการใหม่เริ่มที่ `UNPAID` เสมอ
- รองรับ Dynamic PromptPay QR ตามยอดของ Payment
- Parent อัปโหลดหลักฐาน `JPG`, `PNG` หรือ `PDF`
- ขนาดไฟล์สูงสุด 20 MB และอัปโหลดครั้งละ 1 ไฟล์
- Admin อนุมัติหรือปฏิเสธหลักฐาน
- Admin บันทึกการรับเงินสด
- เมื่อชำระสำเร็จ ระบบสร้างข้อมูลและ PDF ใบเสร็จ
- เลขใบเสร็จใช้ `RC-YYYYMM-######` และนับใหม่รายเดือน
- ไม่มี Bank API หรือ Webhook ในขอบเขตนี้ สถานะ `PAID` จึงเกิดจาก Admin ยืนยันเท่านั้น

Dynamic PromptPay QR เชื่อมไปยัง PromptPay ID ที่ลงทะเบียนกับบัญชีธนาคาร ผู้ชำระสามารถสแกนด้วย Mobile Banking ได้ แต่ Backend ไม่สามารถรู้ผลโอนเงินอัตโนมัติหากไม่มี Payment Gateway/Bank API

## 2. Environment Variables

เพิ่มค่าจริงใน `backend/.env`:

```env
PROMPTPAY_ID=เบอร์โทรศัพท์พร้อมเพย์10หลักหรือเลขประชาชน/ภาษี13หลัก
RECEIPT_ISSUER_NAME=ชื่อจริงของโรงเรียนหรือกิจการ
RECEIPT_TAX_ID=เลขประจำตัวผู้เสียภาษีจริง
RECEIPT_ADDRESS=ที่อยู่จริงของโรงเรียนหรือกิจการ
```

ห้าม Commit ไฟล์ `.env` และห้ามใส่ค่าจริงลง `.env.example`

หากยังไม่กำหนด `PROMPTPAY_ID` Endpoint QR จะตอบ `503 PromptPay is not configured`

## 3. Payment Status Flow

```text
UNPAID
  → Parent Upload Proof
PENDING_VERIFICATION
  → Admin Reject
REJECTED
  → Parent Upload Proof ใหม่
PENDING_VERIFICATION
  → Admin Approve
PAID
```

กรณีเงินสด:

```text
UNPAID หรือ REJECTED
  → Admin บันทึกเงินสด
PAID
```

## 4. Admin Endpoints

ทุก Endpoint ใช้ Admin Bearer Token

### สร้างรายการชำระเงิน

```http
POST /api/admin/payments
Content-Type: application/json
```

```json
{
  "enrollmentId": 1,
  "amount": 3500,
  "dueDate": "2026-09-15",
  "note": "ค่าเรียน"
}
```

ผลสำเร็จ `201 Created` และสถานะ `UNPAID`

### ดูรายการทั้งหมด

```http
GET /api/admin/payments
```

### ดู Payment พร้อมหลักฐานและใบเสร็จ

```http
GET /api/admin/payments/:paymentId
```

### ดาวน์โหลดหลักฐาน

```http
GET /api/admin/payments/proofs/:proofId/file
```

### ตรวจหลักฐานผ่าน

```http
PATCH /api/admin/payments/proofs/:proofId/review
Content-Type: application/json
```

```json
{
  "status": "APPROVED"
}
```

Payment จะเป็น `PAID` และสร้าง Receipt ภายใน Transaction เดียวกัน

### ปฏิเสธหลักฐาน

```json
{
  "status": "REJECTED",
  "rejectionReason": "รูปไม่ชัดเจน"
}
```

### บันทึกเงินสด

```http
POST /api/admin/payments/:paymentId/cash
Content-Type: application/json
```

```json
{
  "note": "รับเงินสดที่โรงเรียน"
}
```

### ดาวน์โหลดใบเสร็จ

```http
GET /api/admin/payments/receipts/:receiptId/download
```

## 5. Parent Endpoints

ทุก Endpoint ใช้ Parent Bearer Token และตรวจว่า Payment เป็นของ Student ในความดูแล

### ดูรายการชำระเงิน

```http
GET /api/parent/payments
```

### ดู Payment พร้อมหลักฐานและใบเสร็จ

```http
GET /api/parent/payments/:paymentId
```

### แสดง Dynamic PromptPay QR

```http
GET /api/parent/payments/:paymentId/qr
```

ผลสำเร็จเป็น `image/png` และกำหนดยอดเงินจาก `payments.amount` โดย Parent เปลี่ยนยอดเองไม่ได้

### Upload หลักฐานใน Postman

```http
POST /api/parent/payments/:paymentId/proofs
Content-Type: multipart/form-data
```

ใน Postman เลือก:

1. Body → `form-data`
2. Key ชื่อ `proof`
3. เปลี่ยนชนิด Key จาก Text เป็น File
4. เลือกไฟล์ `JPG`, `PNG` หรือ `PDF`
5. ใส่ Parent Bearer Token แล้วกด Send

### ดาวน์โหลดหลักฐานของตนเอง

```http
GET /api/parent/payments/proofs/:proofId/file
```

### ดาวน์โหลดใบเสร็จ PDF

```http
GET /api/parent/payments/receipts/:receiptId/download
```

## 6. File Security

- ตรวจขนาดที่ Multer ก่อนประมวลผล
- ตรวจ Extension, MIME ที่ผู้ใช้ส่ง และ File Signature จริง
- ไม่ใช้ชื่อไฟล์ของผู้ใช้เป็น Path
- สุ่มชื่อไฟล์ด้วย UUID
- เก็บใน `backend/private/payment-proofs` ซึ่งไม่ได้เปิดเป็น Static Folder
- ตรวจ Role และ Parent Ownership ทุกครั้งก่อนดาวน์โหลด
- ชื่อไฟล์จริงต้องผ่านรูปแบบ UUID ก่อนนำไปสร้าง Path
- ไฟล์ในโฟลเดอร์ Private ถูก Ignore จาก Git

## 7. Receipt

- Receipt เกิดเมื่อ QR Proof ได้รับอนุมัติหรือ Admin รับเงินสด
- หนึ่ง Payment มี Receipt ได้ไม่เกินหนึ่งใบ
- Running Number ใช้ Database Named Lock ป้องกันเลขซ้ำเมื่อมีหลายคำขอพร้อมกัน
- PDF สร้างตอนดาวน์โหลด จึงไม่ต้องเก็บไฟล์ซ้ำในระบบ
- ใช้ Noto Sans Thai เพื่อรองรับข้อความไทย อังกฤษ และตัวเลข
- รูปแบบนี้เป็นตัวอย่าง ไม่ใช่ใบกำกับภาษี จนกว่าลูกค้าจะยืนยันรูปแบบเอกสารทางกฎหมาย
