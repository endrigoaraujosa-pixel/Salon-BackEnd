export default {
  async up(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    
    await queryInterface.createTable({ schema: currentSchema, tableName: 'colaborador_indisponibilidades' }, {
      id: {
        type: Sequelize.STRING(36),
        primaryKey: true,
        allowNull: false
      },
      colaborador_id: {
        type: Sequelize.STRING(36),
        allowNull: false
      },
      data_hora_inicio: {
        type: Sequelize.DATE,
        allowNull: false
      },
      data_hora_fim: {
        type: Sequelize.DATE,
        allowNull: false
      },
      motivo: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      criado_em: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      criado_por_id: {
        type: Sequelize.STRING(36),
        allowNull: true
      },
      criado_por_nome: {
        type: Sequelize.STRING(255),
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
      }
    });

    // Create a composite index for performance optimization
    await queryInterface.addIndex(
      { schema: currentSchema, tableName: 'colaborador_indisponibilidades' },
      ['colaborador_id', 'deletado', 'data_hora_inicio', 'data_hora_fim'],
      {
        name: `idx_colab_indisp_lookup_${currentSchema || 'public'}`
      }
    );
  },

  async down(queryInterface) {
    const currentSchema = queryInterface.sequelize.options.schema;
    await queryInterface.dropTable({ schema: currentSchema, tableName: 'colaborador_indisponibilidades' });
  }
};
