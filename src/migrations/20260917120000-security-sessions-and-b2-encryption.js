export default {
  async up(q, S) {
    const schema = q.sequelize.options.schema;
    const config = { schema, tableName: 'configuracao_sistema' };
    const sessions = { schema, tableName: 'auth_sessions' };
    await q.sequelize.transaction(async transaction => {
      await q.changeColumn(config, 'b2_application_key', { type: S.TEXT, allowNull: true }, { transaction });
      // Encrypt existing keys only after deploying readers that support ciphertext.
      // scripts/encrypt-b2-credentials.js performs that separate, idempotent step.
      await q.createTable(sessions, {
        id: { type: S.STRING(36), primaryKey: true, allowNull: false },
        user_id: { type: S.STRING(36), allowNull: false },
        password_version: { type: S.STRING(64), allowNull: false },
        refresh_hash: { type: S.STRING(64), allowNull: false },
        previous_hash: { type: S.STRING(64), allowNull: true },
        rotated_at: { type: S.DATE, allowNull: false },
        expires_at: { type: S.DATE, allowNull: false },
        revoked_at: { type: S.DATE, allowNull: true }
      }, { transaction });
      await q.addIndex(sessions, ['expires_at'], { name: 'auth_sessions_expires_at', transaction });
    });
  },
  async down() { throw new Error('Reversão automática desabilitada: preserva credenciais cifradas e revogações de sessões.'); }
};
