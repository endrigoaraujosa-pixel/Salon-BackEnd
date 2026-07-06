export default {
  async up(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    
    // 1. Adicionar o campo usar_comissao_avancada em colaboradores
    await queryInterface.addColumn('colaboradores', 'usar_comissao_avancada', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });

    // 2. Criar a tabela colaborador_comissao_servico
    await queryInterface.createTable({ schema: currentSchema, tableName: 'colaborador_comissao_servico' }, {
      id: {
        type: Sequelize.STRING(36),
        primaryKey: true,
        allowNull: false
      },
      colaborador_id: {
        type: Sequelize.STRING(36),
        allowNull: false
      },
      servico_id: {
        type: Sequelize.STRING(36),
        allowNull: false
      },
      comissao_principal: {
        type: Sequelize.FLOAT,
        allowNull: false,
        defaultValue: 40
      },
      comissao_sozinho: {
        type: Sequelize.FLOAT,
        allowNull: false,
        defaultValue: 40
      },
      comissao_ajuda: {
        type: Sequelize.FLOAT,
        allowNull: false,
        defaultValue: 30
      },
      comissao_auxiliar: {
        type: Sequelize.FLOAT,
        allowNull: false,
        defaultValue: 20
      },
      criado_em: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // 3. Criar índice único para a combinação colaborador_id + servico_id
    await queryInterface.addIndex(
      { schema: currentSchema, tableName: 'colaborador_comissao_servico' },
      ['colaborador_id', 'servico_id'],
      {
        unique: true,
        name: 'colab_servico_unique_idx'
      }
    );
  },

  async down(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    await queryInterface.removeColumn('colaboradores', 'usar_comissao_avancada');
    await queryInterface.dropTable({ schema: currentSchema, tableName: 'colaborador_comissao_servico' });
  }
};
