export default {
  async up(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    await queryInterface.createTable({ schema: currentSchema, tableName: 'inventarios_protocolo' }, {
      id: {
        type: Sequelize.STRING(36),
        primaryKey: true,
        allowNull: false
      },
      numero_protocolo: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      data_conferenca: {
        type: Sequelize.DATE,
        allowNull: false
      },
      usuario_id: {
        type: Sequelize.STRING(36),
        allowNull: false
      },
      usuario_nome: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      qtd_conferida: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      qtd_divergencias: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      valor_divergencia: {
        type: Sequelize.FLOAT,
        allowNull: false,
        defaultValue: 0
      },
      observacao: {
        type: Sequelize.TEXT,
        allowNull: true
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
    await queryInterface.dropTable({ schema: currentSchema, tableName: 'inventarios_protocolo' });
  }
};
