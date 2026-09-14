export default {
  async up(q, S) {
    const schema = q.sequelize.options.schema;
    await q.sequelize.transaction(async transaction => {
      const options = { transaction };
      await q.addColumn({ schema, tableName: 'configuracao_sistema' }, 'permitir_fotos_atendimentos', {
        type: S.BOOLEAN, allowNull: false, defaultValue: false
      }, options);
      await q.createTable({ schema, tableName: 'atendimento_fotos' }, {
        id: { type: S.STRING(36), primaryKey: true, allowNull: false },
        agendamento_id: { type: S.STRING(36), allowNull: false,
          references: { model: { schema, tableName: 'agendamentos' }, key: 'id' }, onDelete: 'CASCADE' },
        cliente_id: { type: S.STRING(36), allowNull: false },
        largura: { type: S.INTEGER, allowNull: false },
        altura: { type: S.INTEGER, allowNull: false },
        bytes: { type: S.INTEGER, allowNull: false },
        imagem: { type: S.BLOB, allowNull: false },
        miniatura: { type: S.BLOB, allowNull: false },
        criado_por_id: S.STRING(36),
        criado_em: { type: S.DATE, allowNull: false }
      }, options);
      await q.addIndex({ schema, tableName: 'atendimento_fotos' }, ['cliente_id', 'agendamento_id'], options);
      await q.createTable({ schema, tableName: 'atendimento_foto_eventos' }, {
        id: { type: S.STRING(36), primaryKey: true, allowNull: false },
        foto_id: { type: S.STRING(36), allowNull: false },
        agendamento_id: { type: S.STRING(36), allowNull: false },
        cliente_id: { type: S.STRING(36), allowNull: false },
        operacao: { type: S.STRING(20), allowNull: false },
        usuario_id: S.STRING(36),
        criado_em: { type: S.DATE, allowNull: false }
      }, options);
    });
  },
  async down(q) {
    const schema = q.sequelize.options.schema;
    await q.sequelize.transaction(async transaction => {
      await q.dropTable({ schema, tableName: 'atendimento_foto_eventos' }, { transaction });
      await q.dropTable({ schema, tableName: 'atendimento_fotos' }, { transaction });
      await q.removeColumn({ schema, tableName: 'configuracao_sistema' }, 'permitir_fotos_atendimentos', { transaction });
    });
  }
};
