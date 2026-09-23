export default {
  async up(q, S) {
    const schema = q.sequelize.options.schema;
    const users = { schema, tableName: 'users' };
    const sessions = { schema, tableName: 'auth_sessions' };
    await q.sequelize.transaction(async transaction => {
      await q.addColumn(users, 'last_access_at', { type: S.DATE, allowNull: true }, { transaction });
      const quote = table => q.queryGenerator.quoteTable(table);
      // Preserve any presence already recorded; never invent dates for old users.
      await q.sequelize.query(`UPDATE ${quote(users)} SET last_access_at = (
        SELECT MAX(last_seen_at) FROM ${quote(sessions)} WHERE user_id = ${quote(users)}.id
      )`, { transaction });
    });
  },
  async down(q) {
    await q.removeColumn({ schema: q.sequelize.options.schema, tableName: 'users' }, 'last_access_at');
  }
};
