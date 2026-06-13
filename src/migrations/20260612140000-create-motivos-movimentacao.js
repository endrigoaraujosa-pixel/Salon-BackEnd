export default {
  async up(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    await queryInterface.createTable({ schema: currentSchema, tableName: 'motivos_movimentacao' }, {
      id: {
        type: Sequelize.STRING(36),
        primaryKey: true,
        allowNull: false
      },
      nome: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      tipo: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      ativo: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });
  },

  async down(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    await queryInterface.dropTable({ schema: currentSchema, tableName: 'motivos_movimentacao' });
  }
};
