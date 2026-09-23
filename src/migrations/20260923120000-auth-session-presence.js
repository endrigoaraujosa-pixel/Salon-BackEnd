export default {
  async up(q, S) {
    const table = { schema: q.sequelize.options.schema, tableName: 'auth_sessions' };
    await q.sequelize.transaction(async transaction => {
      await q.addColumn(table, 'last_seen_at', { type: S.DATE, allowNull: true }, { transaction });
      await q.addIndex(table, ['last_seen_at'], { name: 'auth_sessions_last_seen_at', transaction });
    });
  },
  async down(q) {
    const table = { schema: q.sequelize.options.schema, tableName: 'auth_sessions' };
    await q.sequelize.transaction(async transaction => {
      await q.removeIndex(table, 'auth_sessions_last_seen_at', { transaction });
      await q.removeColumn(table, 'last_seen_at', { transaction });
    });
  }
};
