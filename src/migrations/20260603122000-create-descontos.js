export default {
  async up(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    await queryInterface.createTable({ schema: currentSchema, tableName: 'descontos' }, {
      id: {
        type: Sequelize.STRING(36),
        primaryKey: true,
        allowNull: false
      },
      codigo: {
        type: Sequelize.STRING(100),
        unique: true,
        allowNull: false
      },
      descricao: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      tipo: {
        type: Sequelize.STRING(50),
        defaultValue: 'porcentagem',
        allowNull: false
      },
      valor: {
        type: Sequelize.FLOAT,
        allowNull: false,
        defaultValue: 0
      },
      ativo: {
        type: Sequelize.BOOLEAN,
        defaultValue: true
      },
      itens_vinculados: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      requer_autorizacao: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      incide_comissao: {
        type: Sequelize.BOOLEAN,
        defaultValue: true
      },
      usuarios_autorizados: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      deletado: {
        type: Sequelize.STRING(1),
        defaultValue: 'N',
        allowNull: false
      },
      deletado_por: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      deletado_em: {
        type: Sequelize.DATE,
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

    await queryInterface.addColumn({ schema: currentSchema, tableName: 'vendas_diretas' }, 'desconto_aplicado', {
      type: Sequelize.JSON,
      allowNull: true,
      defaultValue: null
    });

    await queryInterface.addColumn({ schema: currentSchema, tableName: 'agendamentos' }, 'desconto_aplicado', {
      type: Sequelize.JSON,
      allowNull: true,
      defaultValue: null
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('vendas_diretas', 'desconto_aplicado');
    await queryInterface.removeColumn('agendamentos', 'desconto_aplicado');
    await queryInterface.dropTable('descontos');
  }
};
