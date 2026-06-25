export default {
  async up(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;

    // Helper para verificar se tabela existe
    const hasTable = await queryInterface.tableExists({ schema: currentSchema, tableName: 'adquirentes' });
    if (!hasTable) {
      // 1. Criar tabela adquirentes
      await queryInterface.createTable(
        { schema: currentSchema, tableName: 'adquirentes' },
        {
          id: {
            type: Sequelize.STRING(36),
            primaryKey: true,
            allowNull: false
          },
          descricao: {
            type: Sequelize.STRING(255),
            allowNull: false
          },
          ativo: {
            type: Sequelize.BOOLEAN,
            defaultValue: true,
            allowNull: false
          },
          observacao: {
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
          criado_por_id: {
            type: Sequelize.STRING(36),
            allowNull: true
          },
          criado_por_nome: {
            type: Sequelize.STRING(255),
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
        }
      );
    }

    // Helper para verificar colunas
    const getColumns = async (tableName) => {
      try {
        return await queryInterface.describeTable({ schema: currentSchema, tableName });
      } catch (e) {
        return {};
      }
    };

    const tcColumns = await getColumns('taxas_cartao');
    const pagColumns = await getColumns('pagamentos');

    // 2. Adicionar colunas em taxas_cartao
    if (!tcColumns.adquirente_id) {
      await queryInterface.addColumn(
        { schema: currentSchema, tableName: 'taxas_cartao' },
        'adquirente_id',
        {
          type: Sequelize.STRING(36),
          allowNull: true,
          references: {
            model: { schema: currentSchema, tableName: 'adquirentes' },
            key: 'id'
          }
        }
      );
    }

    if (!tcColumns.descricao) {
      await queryInterface.addColumn(
        { schema: currentSchema, tableName: 'taxas_cartao' },
        'descricao',
        {
          type: Sequelize.STRING(100),
          allowNull: true
        }
      );
    }

    if (!tcColumns.tipo_cartao) {
      await queryInterface.addColumn(
        { schema: currentSchema, tableName: 'taxas_cartao' },
        'tipo_cartao',
        {
          type: Sequelize.STRING(10),
          allowNull: true
        }
      );
    }

    // Colunas de parcelamento taxas_cartao
    for (let i = 1; i <= 12; i++) {
      if (!tcColumns[`taxa_${i}x`]) {
        await queryInterface.addColumn(
          { schema: currentSchema, tableName: 'taxas_cartao' },
          `taxa_${i}x`,
          {
            type: Sequelize.FLOAT,
            defaultValue: 0,
            allowNull: true
          }
        );
      }
    }

    // Campos de auditoria em taxas_cartao
    if (!tcColumns.criado_por_id) {
      await queryInterface.addColumn(
        { schema: currentSchema, tableName: 'taxas_cartao' },
        'criado_por_id',
        {
          type: Sequelize.STRING(36),
          allowNull: true
        }
      );
    }

    if (!tcColumns.criado_por_nome) {
      await queryInterface.addColumn(
        { schema: currentSchema, tableName: 'taxas_cartao' },
        'criado_por_nome',
        {
          type: Sequelize.STRING(255),
          allowNull: true
        }
      );
    }

    if (!tcColumns.alterado_por_id) {
      await queryInterface.addColumn(
        { schema: currentSchema, tableName: 'taxas_cartao' },
        'alterado_por_id',
        {
          type: Sequelize.STRING(36),
          allowNull: true
        }
      );
    }

    if (!tcColumns.alterado_por_nome) {
      await queryInterface.addColumn(
        { schema: currentSchema, tableName: 'taxas_cartao' },
        'alterado_por_nome',
        {
          type: Sequelize.STRING(255),
          allowNull: true
        }
      );
    }

    // 3. Adicionar colunas em pagamentos
    if (!pagColumns.cartao_tipo) {
      await queryInterface.addColumn(
        { schema: currentSchema, tableName: 'pagamentos' },
        'cartao_tipo',
        {
          type: Sequelize.STRING(10),
          allowNull: true
        }
      );
    }

    if (!pagColumns.adquirente_id) {
      await queryInterface.addColumn(
        { schema: currentSchema, tableName: 'pagamentos' },
        'adquirente_id',
        {
          type: Sequelize.STRING(36),
          allowNull: true,
          references: {
            model: { schema: currentSchema, tableName: 'adquirentes' },
            key: 'id'
          }
        }
      );
    }

    if (!pagColumns.cartao_parcelas) {
      await queryInterface.addColumn(
        { schema: currentSchema, tableName: 'pagamentos' },
        'cartao_parcelas',
        {
          type: Sequelize.INTEGER,
          allowNull: true
        }
      );
    }

    if (!pagColumns.cartao_taxa_percentual) {
      await queryInterface.addColumn(
        { schema: currentSchema, tableName: 'pagamentos' },
        'cartao_taxa_percentual',
        {
          type: Sequelize.FLOAT,
          allowNull: true
        }
      );
    }

    if (!pagColumns.cartao_taxa_valor) {
      await queryInterface.addColumn(
        { schema: currentSchema, tableName: 'pagamentos' },
        'cartao_taxa_valor',
        {
          type: Sequelize.DECIMAL(10, 2),
          allowNull: true
        }
      );
    }

    if (!pagColumns.valor_liquido) {
      await queryInterface.addColumn(
        { schema: currentSchema, tableName: 'pagamentos' },
        'valor_liquido',
        {
          type: Sequelize.DECIMAL(10, 2),
          allowNull: true
        }
      );
    }

    if (!pagColumns.data_recebimento_prevista) {
      await queryInterface.addColumn(
        { schema: currentSchema, tableName: 'pagamentos' },
        'data_recebimento_prevista',
        {
          type: Sequelize.DATE,
          allowNull: true
        }
      );
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

    // 1. Remover colunas de pagamentos
    const pagCols = ['data_recebimento_prevista', 'valor_liquido', 'cartao_taxa_valor', 'cartao_taxa_percentual', 'cartao_parcelas', 'adquirente_id', 'cartao_tipo'];
    for (const col of pagCols) {
      if (await hasColumn('pagamentos', col)) {
        await queryInterface.removeColumn({ schema: currentSchema, tableName: 'pagamentos' }, col);
      }
    }

    // 2. Remover colunas de taxas_cartao
    const tcCols = ['alterado_por_nome', 'alterado_por_id', 'criado_por_nome', 'criado_por_id', 'tipo_cartao', 'descricao', 'adquirente_id'];
    for (const col of tcCols) {
      if (await hasColumn('taxas_cartao', col)) {
        await queryInterface.removeColumn({ schema: currentSchema, tableName: 'taxas_cartao' }, col);
      }
    }

    for (let i = 1; i <= 12; i++) {
      if (await hasColumn('taxas_cartao', `taxa_${i}x`)) {
        await queryInterface.removeColumn({ schema: currentSchema, tableName: 'taxas_cartao' }, `taxa_${i}x`);
      }
    }

    // 3. Drop tabela adquirentes
    const tableExists = await queryInterface.tableExists({ schema: currentSchema, tableName: 'adquirentes' });
    if (tableExists) {
      await queryInterface.dropTable({ schema: currentSchema, tableName: 'adquirentes' });
    }
  }
};
