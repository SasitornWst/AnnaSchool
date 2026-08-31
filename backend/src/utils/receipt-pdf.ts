import { fileURLToPath } from "node:url";

import PDFDocument from "pdfkit";

import { getReceiptIssuer } from "../config/payment.ts";

const regularFontPath = fileURLToPath(
  new URL(
    "../../node_modules/@expo-google-fonts/noto-sans-thai/400Regular/NotoSansThai_400Regular.ttf",
    import.meta.url,
  ),
);
const boldFontPath = fileURLToPath(
  new URL(
    "../../node_modules/@expo-google-fonts/noto-sans-thai/700Bold/NotoSansThai_700Bold.ttf",
    import.meta.url,
  ),
);

export interface ReceiptPdfData {
  receiptNumber: string;
  issuedAt: string;
  amount: number;
  paymentMethod: string;
  paymentId: number;
  enrollmentId: number;
  studentName: string;
  courseName: string;
  levelName: string;
  note: string | null;
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export async function createReceiptPdf(
  data: ReceiptPdfData,
): Promise<Buffer> {
  const issuer = getReceiptIssuer();

  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const document = new PDFDocument({
      size: "A4",
      margin: 48,
      info: {
        Title: `Receipt ${data.receiptNumber}`,
        Author: issuer.name,
      },
    });

    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);

    document.registerFont("ReceiptRegular", regularFontPath);
    document.registerFont("ReceiptBold", boldFontPath);
    document.font("ReceiptRegular");

    document
      .fillColor("#31557A")
      .font("ReceiptBold")
      .fontSize(24)
      .text("ใบเสร็จรับเงิน", { align: "center" });
    document
      .font("ReceiptRegular")
      .fontSize(11)
      .text("RECEIPT", { align: "center" });

    document.moveDown(1.4);
    document
      .fillColor("#111827")
      .font("ReceiptBold")
      .fontSize(16)
      .text(issuer.name);
    document
      .font("ReceiptRegular")
      .fontSize(10)
      .text(`เลขประจำตัวผู้เสียภาษี: ${issuer.taxId}`)
      .text(`ที่อยู่: ${issuer.address}`);

    document.moveDown();
    const metaTop = document.y;
    document
      .font("ReceiptBold")
      .text("เลขที่ใบเสร็จ", 48, metaTop)
      .font("ReceiptRegular")
      .text(data.receiptNumber, 160, metaTop);
    document
      .font("ReceiptBold")
      .text("วันที่ออก", 330, metaTop)
      .font("ReceiptRegular")
      .text(data.issuedAt, 405, metaTop);

    document.moveDown(2);
    document
      .strokeColor("#CBD5E1")
      .moveTo(48, document.y)
      .lineTo(547, document.y)
      .stroke();
    document.moveDown();

    const details = [
      ["ผู้เรียน", data.studentName],
      ["คอร์ส / ระดับ", `${data.courseName} / ${data.levelName}`],
      ["Enrollment ID", String(data.enrollmentId)],
      ["Payment ID", String(data.paymentId)],
      ["วิธีชำระ", data.paymentMethod === "CASH" ? "เงินสด" : "QR Payment"],
    ];

    for (const [label, value] of details) {
      const rowTop = document.y;
      document
        .font("ReceiptBold")
        .fontSize(11)
        .text(label ?? "", 48, rowTop, { width: 130 });
      document
        .font("ReceiptRegular")
        .text(value ?? "", 180, rowTop, { width: 367 });
      document.moveDown(0.8);
    }

    document.moveDown();
    const totalTop = document.y;
    document
      .roundedRect(48, totalTop, 499, 64, 8)
      .fill("#EFF6FF");
    document
      .fillColor("#1E3A5F")
      .font("ReceiptBold")
      .fontSize(14)
      .text("ยอดชำระรวม", 68, totalTop + 20);
    document
      .fontSize(18)
      .text(
        `${formatMoney(data.amount)} บาท`,
        310,
        totalTop + 18,
        { width: 217, align: "right" },
      );

    document.y = totalTop + 82;
    if (data.note !== null && data.note !== "") {
      document
        .fillColor("#111827")
        .font("ReceiptBold")
        .fontSize(10)
        .text("หมายเหตุ");
      document
        .font("ReceiptRegular")
        .text(data.note);
    }

    document
      .fillColor("#64748B")
      .font("ReceiptRegular")
      .fontSize(9)
      .text(
        "เอกสารนี้สร้างโดยระบบ Anna English School",
        48,
        770,
        { width: 499, align: "center" },
      );

    document.end();
  });
}
