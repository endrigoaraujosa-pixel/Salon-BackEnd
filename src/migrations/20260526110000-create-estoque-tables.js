export default {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();

    // 1. Table: entradas_estoque
    if (!tables.includes('entradas_estoque')) {
      await queryInterface.createTable('entradas_estoque', {
        id: {
          type: Sequelize.STRING(36),
          primaryKey: true,
          allowNull: false
        },
        fornecedor_id: {
          type: Sequelize.STRING(36),
          allowNull: true
        },
        fornecedor_nome: {
          type: Sequelize.STRING(255),
          allowNull: false
        },
        data_entrada: {
          type: Sequelize.STRING(50),
          allowNull: false
        },
        numero_nota: {
          type: Sequelize.STRING(100),
          defaultValue: ''
        },
        observacoes: {
          type: Sequelize.TEXT,
          defaultValue: ''
        },
        valor_total: {
          type: Sequelize.FLOAT,
          allowNull: false,
          defaultValue: 0
        },
        criado_em: {
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
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
    }

    // 2. Table: entradas_estoque_itens
    if (!tables.includes('entradas_estoque_itens')) {
      await queryInterface.createTable('entradas_estoque_itens', {
        id: {
          type: Sequelize.STRING(36),
          primaryKey: true,
          allowNull: false
        },
        entrada_estoque_id: {
          type: Sequelize.STRING(36),
          allowNull: false
        },
        produto_id: {
          type: Sequelize.STRING(36),
          allowNull: false
        },
        produto_nome: {
          type: Sequelize.STRING(255),
          allowNull: false
        },
        quantidade: {
          type: Sequelize.FLOAT,
          allowNull: false,
          defaultValue: 0
        },
        valor_custo: {
          type: Sequelize.FLOAT,
          allowNull: false,
          defaultValue: 0
        },
        subtotal: {
          type: Sequelize.FLOAT,
          allowNull: false,
          defaultValue: 0
        },
        criado_em: {
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
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
    }

    // 3. Table: movimentacoes_estoque
    if (!tables.includes('movimentacoes_estoque')) {
      await queryInterface.createTable('movimentacoes_estoque', {
        id: {
          type: Sequelize.STRING(36),
          primaryKey: true,
          allowNull: false
        },
        produto_id: {
          type: Sequelize.STRING(36),
          allowNull: false
        },
        produto_nome: {
          type: Sequelize.STRING(255),
          allowNull: false
        },
        tipo: {
          type: Sequelize.STRING(50), // 'entrada', 'saida', 'ajuste'
          allowNull: false
        },
        quantidade: {
          type: Sequelize.FLOAT,
          allowNull: false,
          defaultValue: 0
        },
        quantidade_anterior: {
          type: Sequelize.FLOAT,
          allowNull: false,
          defaultValue: 0
        },
        quantidade_atual: {
          type: Sequelize.FLOAT,
          allowNull: false,
          defaultValue: 0
        },
        valor_unitario: {
          type: Sequelize.FLOAT,
          allowNull: false,
          defaultValue: 0
        },
        motivo: {
          type: Sequelize.TEXT,
          defaultValue: ''
        },
        referencia_id: {
          type: Sequelize.STRING(36),
          allowNull: true
        },
        criado_em: {
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
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
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('movimentacoes_estoque');
    await queryInterface.dropTable('entradas_estoque_itens');
    await queryInterface.dropTable('entradas_estoque');
  }
};
