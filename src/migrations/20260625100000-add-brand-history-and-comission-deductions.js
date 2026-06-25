export default {
  async up(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;

    // Helper para verificar se a coluna existe antes de adicionar
    const hasColumn = async (tableName, columnName) => {
      try {
        const info = await queryInterface.describeTable({ schema: currentSchema, tableName });
        return !!info[columnName];
      } catch (e) {
        return false;
      }
    };

    // 1. Criar tabela historico_taxas_cartao
    const tableExists = await queryInterface.tableExists({ schema: currentSchema, tableName: 'historico_taxas_cartao' });
    if (!tableExists) {
      await queryInterface.createTable(
        { schema: currentSchema, tableName: 'historico_taxas_cartao' },
        {
          id: {
            type: Sequelize.STRING(36),
            primaryKey: true,
            allowNull: false
          },
          taxa_cartao_id: {
            type: Sequelize.STRING(50),
            allowNull: false
          },
          operacao: {
            type: Sequelize.STRING(20),
            allowNull: false
          },
          schema: {
            type: Sequelize.STRING(100),
            allowNull: true
          },
          alterado_por_id: {
            type: Sequelize.STRING(36),
            allowNull: true
          },
          alterado_por_nome: {
            type: Sequelize.STRING(255),
            allowNull: true
          },
          valores_anteriores: {
            type: Sequelize.JSON,
            allowNull: true
          },
          valores_novos: {
            type: Sequelize.JSON,
            allowNull: true
          },
          ip_origem: {
            type: Sequelize.STRING(45),
            allowNull: true
          },
          motivo_alteracao: {
            type: Sequelize.TEXT,
            allowNull: true
          },
          created_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
          }
        }
      );
    }

    // 2. Adicionar bandeira em taxas_cartao
    if (await queryInterface.tableExists({ schema: currentSchema, tableName: 'taxas_cartao' })) {
      const tcHasBandeira = await hasColumn('taxas_cartao', 'bandeira');
      if (!tcHasBandeira) {
        await queryInterface.addColumn(
          { schema: currentSchema, tableName: 'taxas_cartao' },
          'bandeira',
          {
            type: Sequelize.STRING(50),
            allowNull: true
          }
        );
      }
    }

    // 3. Adicionar cartao_bandeira em pagamentos
    if (await queryInterface.tableExists({ schema: currentSchema, tableName: 'pagamentos' })) {
      const pagHasBandeira = await hasColumn('pagamentos', 'cartao_bandeira');
      if (!pagHasBandeira) {
        await queryInterface.addColumn(
          { schema: currentSchema, tableName: 'pagamentos' },
          'cartao_bandeira',
          {
            type: Sequelize.STRING(50),
            allowNull: true
          }
        );
      }
    }

    // 4. Adicionar descontar_taxa_cartao_comissao em configuracao_sistema
    if (await queryInterface.tableExists({ schema: currentSchema, tableName: 'configuracao_sistema' })) {
      const configHasDeduction = await hasColumn('configuracao_sistema', 'descontar_taxa_cartao_comissao');
      if (!configHasDeduction) {
        await queryInterface.addColumn(
          { schema: currentSchema, tableName: 'configuracao_sistema' },
          'descontar_taxa_cartao_comissao',
          {
            type: Sequelize.BOOLEAN,
            defaultValue: false,
            allowNull: false
          }
        );
      }
    }
  },

  async down(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;

    // Helper para verificar se a coluna existe antes de remover
    const hasColumn = async (tableName, columnName) => {
      try {
        const info = await queryInterface.describeTable({ schema: currentSchema, tableName });
        return !!info[columnName];
      } catch (e) {
        return false;
      }
    };

    // 1. Remover coluna de configuracao_sistema
    if (await queryInterface.tableExists({ schema: currentSchema, tableName: 'configuracao_sistema' })) {
      if (await hasColumn('configuracao_sistema', 'descontar_taxa_cartao_comissao')) {
        await queryInterface.removeColumn({ schema: currentSchema, tableName: 'configuracao_sistema' }, 'descontar_taxa_cartao_comissao');
      }
    }

    // 2. Remover coluna de pagamentos
    if (await queryInterface.tableExists({ schema: currentSchema, tableName: 'pagamentos' })) {
      if (await hasColumn('pagamentos', 'cartao_bandeira')) {
        await queryInterface.removeColumn({ schema: currentSchema, tableName: 'pagamentos' }, 'cartao_bandeira');
      }
    }

    // 3. Remover coluna de taxas_cartao
    if (await queryInterface.tableExists({ schema: currentSchema, tableName: 'taxas_cartao' })) {
      if (await hasColumn('taxas_cartao', 'bandeira')) {
        await queryInterface.removeColumn({ schema: currentSchema, tableName: 'taxas_cartao' }, 'bandeira');
      }
    }

    // 4. Drop tabela historico_taxas_cartao
    const tableExists = await queryInterface.tableExists({ schema: currentSchema, tableName: 'historico_taxas_cartao' });
    if (tableExists) {
      await queryInterface.dropTable({ schema: currentSchema, tableName: 'historico_taxas_cartao' });
    }
  }
};
