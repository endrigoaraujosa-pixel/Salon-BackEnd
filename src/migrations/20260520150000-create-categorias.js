export default {
  async up(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    await queryInterface.createTable({schema: currentSchema, tableName: 'categorias'}, {
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
        allowNull: false,
        defaultValue: 'ambos'
      },
      ativo: {
        type: Sequelize.BOOLEAN,
        defaultValue: true
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

    // Add categoria_id to produtos
    await queryInterface.addColumn('produtos', 'categoria_id', {
      type: Sequelize.STRING(36),
      allowNull: true
    });

    // Add categoria_id to servicos
    await queryInterface.addColumn('servicos', 'categoria_id', {
      type: Sequelize.STRING(36),
      allowNull: true
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('produtos', 'categoria_id');
    await queryInterface.removeColumn('servicos', 'categoria_id');
    await queryInterface.dropTable('categorias');
  }
};
