export default {
  async up(queryInterface, Sequelize) {
    // 1. Add incide_comissao to descontos table
    const descontosDesc = await queryInterface.describeTable('descontos');
    if (!descontosDesc.incide_comissao) {
      await queryInterface.addColumn('descontos', 'incide_comissao', {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false
      });
    }

    // 2. Add desconto_aplicado JSON to vendas_diretas
    const vendasDesc = await queryInterface.describeTable('vendas_diretas');
    if (!vendasDesc.desconto_aplicado) {
      await queryInterface.addColumn('vendas_diretas', 'desconto_aplicado', {
        type: Sequelize.JSON,
        allowNull: true,
        defaultValue: null
      });
    }

    // 3. Add desconto_aplicado JSON to agendamentos
    const agendDesc = await queryInterface.describeTable('agendamentos');
    if (!agendDesc.desconto_aplicado) {
      await queryInterface.addColumn('agendamentos', 'desconto_aplicado', {
        type: Sequelize.JSON,
        allowNull: true,
        defaultValue: null
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('descontos', 'incide_comissao');
    await queryInterface.removeColumn('vendas_diretas', 'desconto_aplicado');
    await queryInterface.removeColumn('agendamentos', 'desconto_aplicado');
  }
};
