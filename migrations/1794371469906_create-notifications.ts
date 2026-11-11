import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('notifications', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'RESTRICT',
    },
    channel: { type: 'varchar(500)', notNull: false },
    payload: { type: 'jsonb', notNull: false },
    // No DB default: the app always sets the initial status ('pending'). NOT NULL makes a missing one fail loudly.
    status: { type: 'varchar(500)', notNull: true },
    attempts: { type: 'integer', notNull: false },
    last_error: { type: 'text' },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });
  pgm.createIndex('notifications', 'user_id');
  pgm.createIndex('notifications', 'created_at');
  pgm.createIndex('notifications', 'status');

  pgm.createTrigger('notifications', 'notifications_set_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'set_updated_at',
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('notifications');
}
