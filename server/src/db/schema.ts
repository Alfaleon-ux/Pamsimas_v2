import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  serial,
  unique,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ============================================================
// Better Auth Core Tables (user, session, account, verification)
// Extended with `role` and `username` columns
// ============================================================

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: text("role").notNull().default("petugas"), // 'admin' | 'petugas'
  username: text("username").unique(), // Better Auth username plugin
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ============================================================
// Application Tables
// ============================================================

// --- Member (Pelanggan / Warga) ---
export const member = pgTable("member", {
  id: text("id").primaryKey(), // e.g. "P-001"
  fullName: text("full_name").notNull(),
  address: text("address").notNull(),
  zone: text("zone").notNull(), // Blok/Zona
  phone: text("phone").notNull(),
  status: text("status").notNull().default("aktif"), // 'aktif' | 'nonaktif'
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// --- Meter Reading (Pencatatan Meteran) ---
export const meterReading = pgTable(
  "meter_reading",
  {
    id: text("id").primaryKey(), // "{memberId}-{year}-{month}"
    memberId: text("member_id")
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    month: integer("month").notNull(), // 1-12
    prevReading: integer("prev_reading").notNull(),
    currentReading: integer("current_reading").notNull(),
    volume: integer("volume").notNull(), // currentReading - prevReading
    photoUrl: text("photo_url"), // Supabase Storage URL
    officerId: text("officer_id").references(() => user.id, {
      onDelete: "set null",
    }),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  },
  (table) => [unique("meter_reading_unique").on(table.memberId, table.year, table.month)]
);

// --- Payment (Pembayaran) ---
export const payment = pgTable(
  "payment",
  {
    id: text("id").primaryKey(), // "PAY-{timestamp}"
    memberId: text("member_id")
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    amountAir: integer("amount_air").notNull(), // Water charge (Rp)
    amountBeban: integer("amount_beban").notNull(), // Admin/maintenance fee (Rp)
    amountCicilan: integer("amount_cicilan").notNull().default(0), // Installment (Rp)
    total: integer("total").notNull(),
    paidAt: timestamp("paid_at").notNull().defaultNow(),
    receivedBy: text("received_by").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [unique("payment_unique").on(table.memberId, table.year, table.month)]
);

// --- Installment (Cicilan Pemasangan) ---
export const installment = pgTable("installment", {
  id: text("id").primaryKey(), // "CIL-{memberId}"
  memberId: text("member_id")
    .notNull()
    .unique()
    .references(() => member.id, { onDelete: "cascade" }),
  totalAmount: integer("total_amount").notNull(), // Total installation cost (Rp)
  tenure: integer("tenure").notNull(), // Months (3/6/9/12)
  monthlyAmount: integer("monthly_amount").notNull(), // Per-month payment
  monthsPaid: integer("months_paid").notNull().default(0),
  startYear: integer("start_year").notNull(),
  startMonth: integer("start_month").notNull(),
  status: text("status").notNull().default("active"), // 'active' | 'completed'
});

// --- Work Order / SPK (Surat Perintah Kerja) ---
export const workOrder = pgTable("work_order", {
  id: text("id").primaryKey(), // "SPK-{suffix}"
  memberId: text("member_id")
    .notNull()
    .references(() => member.id, { onDelete: "cascade" }),
  fee: integer("fee").notNull(), // Installation cost (Rp)
  method: text("method").notNull(), // 'cash' | 'cicilan'
  status: text("status").notNull().default("pending"), // 'pending' | 'installed'
  serialNumber: text("serial_number"), // Filled on completion
  officerId: text("officer_id").references(() => user.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  installedAt: timestamp("installed_at"), // Completion time
});

// --- Audit Log ---
export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
  username: text("username"), // Denormalized for fast display
  action: text("action").notNull(),
  details: text("details"),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

// --- Settings (Key-Value Store) ---
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================================
// Relations (for Drizzle relational queries)
// ============================================================

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  meterReadings: many(meterReading, { relationName: "officer" }),
  workOrders: many(workOrder, { relationName: "installer" }),
  paymentsReceived: many(payment, { relationName: "receiver" }),
  auditLogs: many(auditLog),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

export const memberRelations = relations(member, ({ many, one }) => ({
  meterReadings: many(meterReading),
  payments: many(payment),
  installment: one(installment),
  workOrders: many(workOrder),
}));

export const meterReadingRelations = relations(meterReading, ({ one }) => ({
  member: one(member, {
    fields: [meterReading.memberId],
    references: [member.id],
  }),
  officer: one(user, {
    fields: [meterReading.officerId],
    references: [user.id],
    relationName: "officer",
  }),
}));

export const paymentRelations = relations(payment, ({ one }) => ({
  member: one(member, {
    fields: [payment.memberId],
    references: [member.id],
  }),
  receiver: one(user, {
    fields: [payment.receivedBy],
    references: [user.id],
    relationName: "receiver",
  }),
}));

export const installmentRelations = relations(installment, ({ one }) => ({
  member: one(member, {
    fields: [installment.memberId],
    references: [member.id],
  }),
}));

export const workOrderRelations = relations(workOrder, ({ one }) => ({
  member: one(member, {
    fields: [workOrder.memberId],
    references: [member.id],
  }),
  officer: one(user, {
    fields: [workOrder.officerId],
    references: [user.id],
    relationName: "installer",
  }),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  user: one(user, {
    fields: [auditLog.userId],
    references: [user.id],
  }),
}));
