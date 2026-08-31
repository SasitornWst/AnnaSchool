import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

interface LockRow extends RowDataPacket {
  acquired: number | null;
}

interface PeriodRow extends RowDataPacket {
  period: string;
}

interface SequenceRow extends RowDataPacket {
  latestSequence: string | number;
}

export interface IssuedReceipt {
  receiptId: number;
  receiptNumber: string;
}

export async function issueReceipt(
  connection: PoolConnection,
  paymentId: number,
  amount: number,
  issuedByUserId: number,
  note: string | null,
): Promise<IssuedReceipt> {
  const [periodRows] =
    await connection.execute<PeriodRow[]>(
      `SELECT DATE_FORMAT(CURRENT_DATE, '%Y%m') AS period`,
    );
  const period = periodRows[0]?.period;

  if (period === undefined) {
    throw new Error("Could not determine receipt period");
  }

  const lockName = `receipt_sequence_${period}`;
  const [lockRows] = await connection.execute<LockRow[]>(
    `SELECT GET_LOCK(?, 10) AS acquired`,
    [lockName],
  );

  if (lockRows[0]?.acquired !== 1) {
    throw new Error("Could not acquire receipt sequence lock");
  }

  try {
    const [sequenceRows] =
      await connection.execute<SequenceRow[]>(
        `SELECT COALESCE(
           MAX(
             CAST(RIGHT(receipt_number, 6) AS UNSIGNED)
           ),
           0
         ) AS latestSequence
         FROM receipts
         WHERE receipt_number LIKE ?`,
        [`RC-${period}-%`],
      );
    const sequence =
      Number(sequenceRows[0]?.latestSequence ?? 0) + 1;

    if (sequence > 999999) {
      throw new Error(
        `Receipt sequence exhausted for ${period}`,
      );
    }

    const receiptNumber =
      `RC-${period}-${String(sequence).padStart(6, "0")}`;
    const [result] =
      await connection.execute<ResultSetHeader>(
        `INSERT INTO receipts (
           payment_id,
           receipt_number,
           amount,
           issued_by_user_id,
           issued_at,
           file_path,
           note
         ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, NULL, ?)`,
        [
          paymentId,
          receiptNumber,
          amount,
          issuedByUserId,
          note,
        ],
      );

    return {
      receiptId: result.insertId,
      receiptNumber,
    };
  } finally {
    await connection.execute(
      `SELECT RELEASE_LOCK(?)`,
      [lockName],
    );
  }
}
