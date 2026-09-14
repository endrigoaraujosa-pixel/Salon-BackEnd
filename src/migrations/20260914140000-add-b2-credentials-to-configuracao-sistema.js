/**
 * Migration: adiciona b2_key_id e b2_application_key à configuracao_sistema.
 *
 * As credenciais armazenadas aqui têm prioridade sobre as variáveis de ambiente,
 * permitindo configuração via interface sem redeploy.
 * A applicationKey é tratada como segredo: nunca é devolvida pela API GET.
 */
export default {
  async up(q, S) {
    const schema = q.sequelize.options.schema;
    await q.addColumn({ schema, tableName: 'configuracao_sistema' }, 'b2_key_id', {
      type: S.STRING(100), allowNull: true
    });
    await q.addColumn({ schema, tableName: 'configuracao_sistema' }, 'b2_application_key', {
      type: S.STRING(255), allowNull: true
    });
  },
  async down(q) {
    const schema = q.sequelize.options.schema;
    await q.removeColumn({ schema, tableName: 'configuracao_sistema' }, 'b2_application_key');
    await q.removeColumn({ schema, tableName: 'configuracao_sistema' }, 'b2_key_id');
  }
};
