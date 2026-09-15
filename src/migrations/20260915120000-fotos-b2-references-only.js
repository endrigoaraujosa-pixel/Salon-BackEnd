export default {
  async up(q, S) {
    const table = { schema: q.sequelize.options.schema, tableName: 'atendimento_fotos' };
    await q.sequelize.transaction(async transaction => {
      for (const column of ['b2_imagem_version', 'b2_miniatura_version'])
        await q.addColumn(table, column, { type: S.STRING(255), allowNull: true }, { transaction });
      for (const column of ['imagem', 'miniatura'])
        await q.changeColumn(table, column, { type: S.BLOB, allowNull: true }, { transaction });
    });
  },
  async down() {
    throw new Error('Rollback indisponível: fotos no B2 não podem voltar a exigir BLOB sem restauração prévia.');
  }
};
