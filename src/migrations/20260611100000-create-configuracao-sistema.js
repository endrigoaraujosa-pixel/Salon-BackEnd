export default {
  async up(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    await queryInterface.createTable(
      { schema: currentSchema, tableName: 'configuracao_sistema' },
      {
        id: {
          type: Sequelize.INTEGER,
          primaryKey: true,
          autoIncrement: true,
          allowNull: false
        },
        bloquear_valor_agendamento_menor: {
          type: Sequelize.BOOLEAN,
          defaultValue: false,
          allowNull: false
        },
        criado_em: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
        },
        atualizado_em: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
        }
      }
    );
  },

  async down(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    await queryInterface.dropTable({ schema: currentSchema, tableName: 'configuracao_sistema' });
  }
};
