import { SignJWT, jwtVerify } from "jose";

function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (value === undefined) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

const jwtSecretValue = getRequiredEnv("JWT_SECRET");
const jwtExpiresIn = getRequiredEnv("JWT_EXPIRES_IN");

if (jwtSecretValue.length < 32) {
  throw new Error("JWT_SECRET must contain at least 32 characters");
}

const jwtSecret = new TextEncoder().encode(jwtSecretValue);

export interface AuthTokenPayload {
  userId: number;
  username: string;
  role: string;
}

export async function createAccessToken(
  payload: AuthTokenPayload,
): Promise<string> {
  return new SignJWT({
    username: payload.username,
    role: payload.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(payload.userId))
    .setIssuedAt()
    .setExpirationTime(jwtExpiresIn)
    .sign(jwtSecret);
}

export async function verifyAccessToken(
  token: string,
): Promise<AuthTokenPayload> {
  const { payload } = await jwtVerify(token, jwtSecret, {
    algorithms: ["HS256"],
  });

  const userId = Number(payload.sub);
  const username = payload.username;
  const role = payload.role;

  if (
    !Number.isInteger(userId) ||
    typeof username !== "string" ||
    typeof role !== "string"
  ) {
    throw new Error("Invalid access token payload");
  }

  return {
    userId,
    username,
    role,
  };
}
