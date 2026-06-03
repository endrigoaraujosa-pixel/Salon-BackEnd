export default {
  async up(queryInterface, Sequelize) {

    await queryInterface.addColumn('vendas_diretas', 'data_lancamento', {
      type: Sequelize.DATE,
      allowNull: true,
      defaultValue: null
    });
    await queryInterface.addColumn('vendas_diretas', 'criado_por_id', {
      type: Sequelize.STRING(36),
      allowNull: true,
      defaultValue: null
    });

    await queryInterface.addColumn('vendas_diretas', 'criado_por_nome', {
      type: Sequelize.STRING(255),
      allowNull: true,
      defaultValue: null
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('vendas_diretas', 'data_lancamento');
    await queryInterface.removeColumn('vendas_diretas', 'criado_por_id');
    await queryInterface.removeColumn('vendas_diretas', 'criado_por_nome');
  }
};
