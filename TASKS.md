# TASKS.md

# Task Tracker — ระบบสมัครเรียนโรงเรียนสอนภาษาอังกฤษ

## กติกา
สถานะที่ใช้:
- `TODO` ยังไม่เริ่ม
- `IN PROGRESS` กำลังทำ
- `BLOCKED` ติดปัญหา
- `DONE` ทำและทดสอบผ่านแล้ว

ห้ามข้าม Task โดยไม่มีเหตุผล
เมื่อทำ Task ใดเสร็จ ต้องมีหลักฐานการทดสอบก่อนเปลี่ยนเป็น DONE

---

# Phase 0 — ยืนยันขอบเขต

- [x] สรุปผู้ใช้งานหลัก: Admin / Teacher / Parent
- [x] ยืนยันว่านักเรียนไม่มีบัญชี Login
- [x] สรุป Flow สมัครเรียน
- [x] สรุป Flow บัญชีผู้ปกครอง 2 วิธี
- [x] แยก Course / Level / Class
- [x] สรุปตารางเรียนแบบรายครั้ง
- [x] สรุประบบติดตามชั่วโมง
- [x] สรุปการชำระเงิน
- [x] สรุปการประเมินหลังจบคอร์ส
- [ ] ยืนยันชื่อภาษาอังกฤษจริงของ 3 คอร์ส
- [ ] ยืนยันช่วงอายุ 13–14 ปี
- [ ] ยืนยันราคาและจำนวนชั่วโมงจริง
- [ ] ยืนยันรายละเอียดโปรโมชั่น
- [ ] ยืนยันรูปแบบใบเสร็จ

---

# Phase 1 — วางโครงสร้างโปรเจกต์

- [x] ตรวจเครื่องมือที่ติดตั้งในเครื่อง
- [x] ตัดสินใจโครงสร้าง Frontend / Backend
- [x] ตัดสินใจ Backend Framework โดยเข้าใจเหตุผลก่อน
- [x] กำหนดโครงสร้าง Folder
- [x] กำหนด Environment Variable ที่ต้องใช้
- [x] กำหนดมาตรฐานชื่อไฟล์ ตาราง และ Field
- [x] ทบทวน Architecture: Frontend → API → Backend → MySQL

**Checkpoint:** ผู้พัฒนาต้องอธิบาย Flow Request หนึ่งครั้งด้วยภาษาของตนเองได้

---

# Phase 2 — ออกแบบ Database

ทำทีละ Module ห้ามสร้างทุกตารางรวดเดียว

- [x] วาด Entity/Relationship ระดับภาพรวม
- [x] ออกแบบข้อมูล User/Role
- [x] ออกแบบข้อมูล Parent
- [x] ออกแบบข้อมูล Student และความสัมพันธ์ Parent-Student
- [x] ออกแบบข้อมูล Teacher
- [x] ออกแบบ Course
- [x] ออกแบบ Level
- [x] ออกแบบ Application สมัครเรียน
- [x] ออกแบบ Enrollment/การลงทะเบียนเรียน
- [x] ออกแบบ Class
- [x] ออกแบบ Class Member
- [x] ออกแบบ Schedule
- [x] ออกแบบ Teaching Session
- [x] ออกแบบ Attendance
- [x] ออกแบบข้อมูลติดตามชั่วโมง
- [x] ออกแบบ Payment
- [x] ออกแบบ Payment Proof
- [x] ออกแบบ Receipt
- [x] ออกแบบ Evaluation
- [x] ออกแบบข้อมูลคำตอบ/ผลประเมิน
- [x] ตรวจ Primary Key / Foreign Key
- [x] ตรวจ Cardinality
- [x] ตรวจ Duplicate Data
- [x] ตรวจว่ารองรับนักเรียนหลายคนต่อผู้ปกครอง
- [x] ตรวจว่านักเรียนหนึ่งคนเรียนหลายคอร์สได้
- [x] ตรวจความถูกต้องของ Flow ชั่วโมงเรียน

**Checkpoint:** อธิบายได้ว่าแต่ละตารางมีไว้ทำอะไรและสัมพันธ์กันอย่างไร

---

# Phase 3 — MySQL / XAMPP

- [x] เปิดและตรวจ MySQL ใน XAMPP
- [x] สร้าง Database
- [x] ตั้ง Charset/Collation ที่เหมาะสม
- [x] สร้างตารางชุดแรก
- [x] ทดสอบ INSERT
- [x] ทดสอบ SELECT
- [x] ทดสอบ UPDATE
- [x] ทดสอบ DELETE ในข้อมูลทดลอง
- [x] ทดสอบ Foreign Key
- [x] ทดสอบ JOIN ที่จำเป็น
- [x] ตรวจข้อมูลภาษาไทย
- [x] เพิ่มข้อมูลจำลองขั้นต่ำสำหรับพัฒนา

**Checkpoint:** Database ทำงานได้ก่อนเริ่ม Backend

---

# Phase 4 — Backend Foundation

- [x] เตรียม Node.js Backend
- [x] ติดตั้ง Package ทีละตัวพร้อมเรียนรู้หน้าที่
- [x] สร้าง Environment Configuration
- [x] เชื่อม MySQL
- [x] สร้าง Endpoint ทดสอบ Server
- [x] สร้าง Endpoint ทดสอบ Database
- [x] จัด Error Handling เบื้องต้น
- [x] กำหนดรูปแบบ API Response

**Postman Gate:** Endpoint ทดสอบต้องผ่านก่อนทำ Module ธุรกิจ

---

# Phase 5 — Authentication / Authorization

- [x] ทำ Password Hashing
- [x] ทำ Login
- [x] ทดสอบ Login สำเร็จ
- [x] ทดสอบ Password ผิด
- [x] ทดสอบ User ไม่มีอยู่
- [x] ทดสอบบัญชีไม่ Active/ยังไม่อนุมัติ
- [x] ทำ Authentication Token/Session ตามแนวทางที่เลือก
- [x] ทำ Middleware ตรวจตัวตน
- [x] ทำ Role Authorization
- [x] ทดสอบ Admin
- [x] ทดสอบ Teacher
- [x] ทดสอบ Parent
- [x] ทดสอบ 401
- [x] ทดสอบ 403
- [x] ทำ Logout ตาม Architecture ที่เลือก
- [x] ทำเปลี่ยน Password

**Security Gate:** Parent ต้องไม่สามารถเปิดข้อมูล Student ของ Parent คนอื่นได้

---

# Phase 6 — ระบบสมัครเรียน

- [x] API รายการคอร์ส Public
- [x] API รายละเอียดคอร์ส Public
- [x] API ส่งใบสมัคร
- [x] รองรับผู้ปกครองหนึ่งคน + นักเรียนมากกว่า 1 คน
- [x] Validation ใบสมัคร
- [x] API Admin ดูรายการสมัคร
- [x] API Admin ดูรายละเอียดใบสมัคร
- [x] API เปลี่ยนสถานะใบสมัคร
- [x] Flow หลังพูดคุยกับผู้ปกครอง
- [x] ทดสอบ Postman ทุก Endpoint

---

# Phase 7 — บัญชีผู้ปกครอง

- [x] API ลงทะเบียน Parent ด้วยตนเอง
- [x] สถานะรออนุมัติ
- [x] API Admin ดูคำขอลงทะเบียน
- [x] API Admin อนุมัติ
- [x] API Admin ปฏิเสธ
- [x] API Admin สร้างบัญชี Parent
- [x] Generate Username/Password หากเลือกใช้
- [x] เชื่อม Parent กับ Student ที่ถูกต้อง
- [x] ทดสอบบัญชีที่ยังไม่อนุมัติ Login ไม่ได้
- [x] ทดสอบบัญชีที่อนุมัติ Login ได้

---

# Phase 8 — จัดการครู

- [x] Admin เพิ่มครู
- [x] Admin แก้ไขครู
- [x] Admin เปิด/ปิดบัญชีครู
- [x] Admin สร้างข้อมูล Login ครู
- [x] Teacher ดู Profile ตนเอง
- [x] ตรวจสิทธิ์ Teacher

---

# Phase 9 — Course / Level / Class

- [x] CRUD Course
- [x] เปิด/ปิดรับสมัคร Course
- [x] Promotion
- [x] Level
- [x] สร้าง Class
- [x] กำหนด Course ให้ Class
- [x] กำหนด Level
- [x] กำหนด Teacher
- [x] เพิ่ม Student เข้าคลาส
- [x] ย้าย/นำ Student ออกจากคลาส
- [x] ตรวจนักเรียนเรียนหลาย Course ได้
- [x] ทดสอบ Postman

---

# Phase 10 — ตารางเรียน

- [x] เพิ่มตารางเรียนรายครั้ง
- [x] แก้ไขตาราง
- [x] เลื่อนตาราง
- [x] ยกเลิกตาราง
- [x] Teacher ดูตารางตนเอง
- [x] Parent ดูตาราง Student
- [x] ตรวจสิทธิ์
- [x] ทดสอบกรณีเวลาไม่ถูกต้อง
- [x] พิจารณาการตรวจตารางชนกัน

---

# Phase 11 — การสอน / Attendance / ชั่วโมง

- [ ] Teacher เปิด Teaching Session
- [ ] บันทึกเนื้อหาการสอน
- [ ] บันทึก Attendance
- [ ] บันทึกจำนวนชั่วโมง
- [ ] บันทึกความก้าวหน้า
- [ ] คำนวณ Used Hours
- [ ] คำนวณ Remaining Hours
- [ ] รองรับ 1.5 ชั่วโมง
- [ ] ป้องกันชั่วโมงติดลบ
- [ ] ป้องกันการหักซ้ำ
- [ ] Parent ดูประวัติการเรียน
- [ ] Parent ดูชั่วโมง
- [ ] Admin ตรวจสอบ
- [ ] ทดสอบ Postman ทุกกรณีสำคัญ

---

# Phase 12 — การชำระเงิน

- [ ] สร้างรายการชำระเงิน
- [ ] สถานะยังไม่ชำระ
- [ ] Upload หลักฐาน
- [ ] ตรวจชนิดไฟล์
- [ ] ตรวจขนาดไฟล์
- [ ] Admin ดูหลักฐาน
- [ ] Admin ยืนยันชำระแล้ว
- [ ] บันทึกเงินสด
- [ ] รองรับ QR Payment ในระดับที่กำหนด
- [ ] ทำข้อมูลใบเสร็จ
- [ ] Parent ดู/ดาวน์โหลดหลักฐานหรือใบเสร็จ
- [ ] ตรวจ Authorization ของไฟล์

---

# Phase 13 — Evaluation

- [ ] กำหนดเงื่อนไขว่าจบคอร์สแล้วจึงประเมินได้
- [ ] API แบบประเมิน
- [ ] Parent ส่งผลประเมิน
- [ ] ป้องกันการประเมินซ้ำตามกติกาที่กำหนด
- [ ] Admin ดูผลสรุป
- [ ] ทดสอบ Postman

---

# Phase 14 — Reports

- [ ] จำนวนนักเรียน
- [ ] นักเรียนแยกตามคอร์ส
- [ ] จำนวนคลาส
- [ ] ตารางสอนครู
- [ ] ชั่วโมงเรียน Student
- [ ] ชั่วโมงสอน Teacher
- [ ] คอร์สยอดนิยม
- [ ] รายได้จากคอร์ส
- [ ] Payment Status
- [ ] Evaluation Summary
- [ ] ตรวจ SQL JOIN/GROUP BY ที่ใช้
- [ ] ตรวจว่ารายงานตรงกับข้อมูลจริง

---

# Phase 15 — Frontend Foundation

เริ่มเมื่อ API ที่จำเป็นผ่าน Postman แล้ว

- [ ] เตรียม React + TypeScript
- [ ] ติดตั้ง/ตั้งค่า Tailwind CSS
- [ ] วาง Theme ม่วง-ขาว
- [ ] กำหนด Layout Public
- [ ] กำหนด Layout Admin
- [ ] กำหนด Layout Teacher
- [ ] กำหนด Layout Parent
- [ ] ทำ Component พื้นฐานทีละตัว
- [ ] เชื่อม API Client
- [ ] จัดการ Loading/Error/Empty State

---

# Phase 16 — Public Website

- [ ] หน้า Home
- [ ] ข้อมูลโรงเรียน
- [ ] รายการ Course
- [ ] Course Detail
- [ ] สมัครเรียน
- [ ] เพิ่ม Student มากกว่า 1 คนใน Form
- [ ] หน้าสมัครสำเร็จ
- [ ] Responsive

---

# Phase 17 — Parent Frontend

- [ ] Login
- [ ] Registration
- [ ] หน้า Pending Approval
- [ ] Dashboard
- [ ] เลือก Student
- [ ] Student Detail
- [ ] Course/Class
- [ ] Schedule
- [ ] Learning History
- [ ] Hours
- [ ] Payment
- [ ] Upload Slip
- [ ] Receipt
- [ ] Evaluation
- [ ] Profile/Password

---

# Phase 18 — Teacher Frontend

- [ ] Login
- [ ] Dashboard
- [ ] Schedule
- [ ] Class List
- [ ] Student List
- [ ] Teaching Session
- [ ] Attendance
- [ ] Teaching Note
- [ ] Progress
- [ ] Profile/Password

---

# Phase 19 — Admin Frontend

- [ ] Login
- [ ] Dashboard
- [ ] Applications
- [ ] Parent Approval
- [ ] Create Parent Account
- [ ] Teachers
- [ ] Students
- [ ] Courses
- [ ] Levels
- [ ] Classes
- [ ] Schedules
- [ ] Teaching Records
- [ ] Payments
- [ ] Receipts
- [ ] Evaluations
- [ ] Reports
- [ ] User/Role Management

---

# Phase 20 — End-to-End Testing

- [ ] สมัครเรียนตั้งแต่หน้า Public
- [ ] Admin ตรวจใบสมัคร
- [ ] สร้าง/อนุมัติ Parent
- [ ] Login Parent
- [ ] ยืนยัน Enrollment
- [ ] Payment
- [ ] จัด Class
- [ ] จัด Teacher
- [ ] Schedule
- [ ] Teacher Login
- [ ] Teacher บันทึกการสอน
- [ ] ตรวจชั่วโมงถูกหัก
- [ ] Parent เห็นข้อมูล
- [ ] จบคอร์ส
- [ ] Evaluation
- [ ] Reports
- [ ] Security Test
- [ ] Validation Test
- [ ] Regression Test Feature สำคัญ

---

# Task ปัจจุบัน

**NEXT TASK:** Phase 1 — ตรวจเครื่องมือและวางโครงสร้างโปรเจกต์

สิ่งที่ Codex ต้องทำใน Task แรก:
1. ห้ามสร้างไฟล์ Source Code
2. อ่าน CODEX_PROJECT_GUIDE.md และ TASKS.md
3. สรุป Architecture ที่เข้าใจ
4. บอกว่าเครื่องมือใดต้องตรวจเวอร์ชัน
5. ให้คำสั่งตรวจเวอร์ชันทีละคำสั่ง
6. อธิบายแต่ละคำสั่ง
7. รอผลลัพธ์จากผู้พัฒนาก่อน
