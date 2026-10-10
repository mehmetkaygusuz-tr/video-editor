import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  width: integer('width').notNull().default(1920),
  height: integer('height').notNull().default(1080),
  fps: real('fps').notNull().default(30),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const assets = sqliteTable('assets', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  opfsHandleUri: text('opfs_handle_uri').notNull(), // The path in OPFS
  mimeType: text('mime_type').notNull(),
  duration: real('duration').notNull(),
  width: integer('width'),
  height: integer('height'),
  createdAt: integer('created_at').notNull(),
});

export const tracks = sqliteTable('tracks', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type', { enum: ['video', 'audio', 'text'] }).notNull(),
  orderIndex: integer('order_index').notNull(),
});

export const clips = sqliteTable('clips', {
  id: text('id').primaryKey(),
  trackId: text('track_id').notNull().references(() => tracks.id, { onDelete: 'cascade' }),
  assetId: text('asset_id').references(() => assets.id, { onDelete: 'set null' }),
  startTime: real('start_time').notNull(), // Position on the timeline
  duration: real('duration').notNull(), // Visible duration on the timeline
  trimIn: real('trim_in').notNull().default(0), // Starting offset in the media asset
  trimOut: real('trim_out').notNull(), // Ending offset in the media asset
  opacity: real('opacity').notNull().default(1),
  createdAt: integer('created_at').notNull(),
});

export const undoLog = sqliteTable('undo_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tableName: text('table_name').notNull(),
  action: text('action').notNull(), // INSERT, UPDATE, DELETE
  undoSql: text('undo_sql').notNull(), // The SQL required to revert this action
  timestamp: integer('timestamp').notNull(),
});
