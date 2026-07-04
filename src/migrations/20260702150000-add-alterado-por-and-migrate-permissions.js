export default {
  async up(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    
    // 1. Add column alterado_por to perfis_acesso table
    await queryInterface.addColumn({ schema: currentSchema, tableName: 'perfis_acesso' }, 'alterado_por', {
      type: Sequelize.STRING(255),
      allowNull: true
    });

    // 2. Fetch and migrate existing profiles
    const perfis = await queryInterface.sequelize.query(
      `SELECT id, nome, permissoes FROM "${currentSchema}"."perfis_acesso";`,
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    );

    const listAllKeys = [
      "dashboard.visualizar", "dashboard.faturamento",
      "agenda.visualizar", "agenda.criar", "agenda.editar", "agenda.status", "agenda.concluir", 
      "agenda.pagamento", "agenda.pagamento.excluir", "agenda.aplicar_desconto", "agenda.excluir", "agenda.whatsapp_historico",
      "clientes.visualizar", "clientes.criar", "clientes.editar", "clientes.excluir", 
      "clientes.credito.visualizar", "clientes.credito.gerenciar", "clientes.credito.recalcular",
      "colaboradores.visualizar", "colaboradores.dados_sensiveis", "colaboradores.criar", "colaboradores.editar", "colaboradores.excluir", "colaboradores.indisponibilidade",
      "servicos.visualizar", "servicos.criar", "servicos.editar", "servicos.excluir",
      "produtos.visualizar", "produtos.criar", "produtos.editar", "produtos.excluir",
      "estoque.visualizar", "estoque.entrada", "estoque.movimentar", "estoque.ajustar", "estoque.inventariar", "estoque.zerar",
      "vendas.visualizar", "vendas.criar", "vendas.editar", "vendas.pagamento", "vendas.aplicar_desconto", "vendas.cancelar",
      "despesas.visualizar", "despesas.criar", "despesas.editar", "despesas.excluir",
      "receitas.visualizar", "receitas.criar", "receitas.editar", "receitas.excluir",
      "comissoes.visualizar", "comissoes.visualizar_todos", "comissoes.pagar", "comissoes.estornar",
      "relatorios.dre", "relatorios.caixa", "relatorios.cartoes", "relatorios.operacional", "relatorios.vendas", "relatorios.estoque",
      "cadastros.visualizar", "cadastros.categorias", "cadastros.taxas", "cadastros.fornecedores", "cadastros.pagamento", "cadastros.adquirentes", "cadastros.descontos", "cadastros.motivos_estoque",
      "configuracoes.empresa", "configuracoes.sistema", "configuracoes.whatsapp",
      "usuarios.visualizar", "usuarios.criar", "usuarios.editar", "usuarios.excluir",
      "perfis.visualizar", "perfis.criar", "perfis.editar", "perfis.excluir",
      "auditoria.visualizar", "auditoria.restaurar"
    ];

    for (const p of perfis) {
      let oldPerms = {};
      try {
        oldPerms = typeof p.permissoes === 'string' ? JSON.parse(p.permissoes) : p.permissoes;
      } catch (e) {
        oldPerms = {};
      }

      const newPerms = {};
      
      // If it is the admin profile or represents an admin
      const isAdmin = p.id === 'admin-profile-uuid-00000000000000000' || p.nome === 'Administrador' || oldPerms.acoes?.is_admin === true;

      if (isAdmin) {
        listAllKeys.forEach(k => {
          newPerms[k] = true;
        });
      } else {
        const menus = oldPerms.menus || {};
        const acoes = oldPerms.acoes || {};

        newPerms["dashboard.visualizar"] = !!menus.dashboard;
        newPerms["dashboard.faturamento"] = false;

        newPerms["agenda.visualizar"] = !!menus.agenda;
        newPerms["agenda.criar"] = !!(menus.agenda && acoes.criar);
        newPerms["agenda.editar"] = !!(menus.agenda && acoes.editar);
        newPerms["agenda.status"] = !!(menus.agenda && acoes.editar);
        newPerms["agenda.concluir"] = !!(menus.agenda && acoes.realizar_pagamento);
        newPerms["agenda.pagamento"] = !!(menus.agenda && acoes.realizar_pagamento);
        newPerms["agenda.pagamento.excluir"] = false;
        newPerms["agenda.aplicar_desconto"] = !!(menus.agenda && acoes.realizar_pagamento);
        newPerms["agenda.excluir"] = !!(menus.agenda && acoes.excluir);
        newPerms["agenda.whatsapp_historico"] = !!menus.agenda;

        newPerms["clientes.visualizar"] = !!menus.clientes;
        newPerms["clientes.criar"] = !!(menus.clientes && acoes.criar);
        newPerms["clientes.editar"] = !!(menus.clientes && acoes.editar);
        newPerms["clientes.excluir"] = !!(menus.clientes && acoes.excluir);
        newPerms["clientes.credito.visualizar"] = !!acoes["credito.extrato"];
        newPerms["clientes.credito.gerenciar"] = !!(acoes["credito.adicionar"] || acoes["credito.remover"] || acoes["credito.estornar"]);
        newPerms["clientes.credito.recalcular"] = !!acoes["credito.recalcular"];

        newPerms["colaboradores.visualizar"] = !!menus.colaboradores;
        newPerms["colaboradores.dados_sensiveis"] = false;
        newPerms["colaboradores.criar"] = !!(menus.colaboradores && acoes.criar);
        newPerms["colaboradores.editar"] = !!(menus.colaboradores && acoes.editar);
        newPerms["colaboradores.excluir"] = !!(menus.colaboradores && acoes.excluir);
        newPerms["colaboradores.indisponibilidade"] = !!menus.colaboradores;

        newPerms["servicos.visualizar"] = !!menus.servicos;
        newPerms["servicos.criar"] = !!(menus.servicos && acoes.criar);
        newPerms["servicos.editar"] = !!(menus.servicos && acoes.editar);
        newPerms["servicos.excluir"] = !!(menus.servicos && acoes.excluir);

        newPerms["produtos.visualizar"] = !!menus.produtos;
        newPerms["produtos.criar"] = !!(menus.produtos && acoes.criar);
        newPerms["produtos.editar"] = !!(menus.produtos && acoes.editar);
        newPerms["produtos.excluir"] = !!(menus.produtos && acoes.excluir);

        newPerms["estoque.visualizar"] = !!(menus.estoque || acoes["estoque.visualizar"]);
        newPerms["estoque.entrada"] = !!menus.estoque;
        newPerms["estoque.movimentar"] = !!acoes["estoque.movimentar"];
        newPerms["estoque.ajustar"] = !!acoes["estoque.ajustar"];
        newPerms["estoque.inventariar"] = !!acoes["estoque.inventariar"];
        newPerms["estoque.zerar"] = !!acoes["estoque.zerar"];

        newPerms["vendas.visualizar"] = !!menus.vendas;
        newPerms["vendas.criar"] = !!(menus.vendas && acoes.criar);
        newPerms["vendas.editar"] = !!(menus.vendas && acoes.editar);
        newPerms["vendas.pagamento"] = !!(menus.vendas && acoes.realizar_pagamento);
        newPerms["vendas.aplicar_desconto"] = !!(menus.vendas && acoes.realizar_pagamento);
        newPerms["vendas.cancelar"] = !!(menus.vendas && acoes.excluir);

        newPerms["despesas.visualizar"] = !!menus.despesas;
        newPerms["despesas.criar"] = !!(menus.despesas && acoes.criar);
        newPerms["despesas.editar"] = !!(menus.despesas && acoes.editar);
        newPerms["despesas.excluir"] = !!(menus.despesas && acoes.excluir);

        newPerms["receitas.visualizar"] = !!menus.receitas;
        newPerms["receitas.criar"] = !!(menus.receitas && acoes.criar);
        newPerms["receitas.editar"] = !!(menus.receitas && acoes.editar);
        newPerms["receitas.excluir"] = !!(menus.receitas && acoes.excluir);

        newPerms["comissoes.visualizar"] = !!menus.comissoes;
        newPerms["comissoes.visualizar_todos"] = false;
        newPerms["comissoes.pagar"] = !!(menus.comissoes && acoes.editar);
        newPerms["comissoes.estornar"] = !!(menus.comissoes && acoes.excluir);

        newPerms["relatorios.dre"] = !!menus.relatorios;
        newPerms["relatorios.caixa"] = !!menus.relatorios;
        newPerms["relatorios.cartoes"] = !!menus.relatorios;
        newPerms["relatorios.operacional"] = !!menus.relatorios;
        newPerms["relatorios.vendas"] = !!menus.relatorios;
        newPerms["relatorios.estoque"] = !!menus.relatorios;

        newPerms["cadastros.visualizar"] = !!menus.cadastros;
        newPerms["cadastros.categorias"] = !!menus.produtos;
        newPerms["cadastros.taxas"] = !!menus.cadastros;
        newPerms["cadastros.fornecedores"] = !!menus.cadastros;
        newPerms["cadastros.pagamento"] = !!menus.cadastros;
        newPerms["cadastros.adquirentes"] = !!menus.cadastros;
        newPerms["cadastros.descontos"] = !!menus.cadastros;
        newPerms["cadastros.motivos_estoque"] = !!menus.cadastros;

        newPerms["configuracoes.empresa"] = !!menus.configuracoes;
        newPerms["configuracoes.sistema"] = !!menus.configuracoes;
        newPerms["configuracoes.whatsapp"] = !!menus.configuracoes;

        newPerms["usuarios.visualizar"] = !!menus.usuarios;
        newPerms["usuarios.criar"] = !!(menus.usuarios && acoes.criar);
        newPerms["usuarios.editar"] = !!(menus.usuarios && acoes.editar);
        newPerms["usuarios.excluir"] = !!(menus.usuarios && acoes.excluir);

        newPerms["perfis.visualizar"] = !!menus.usuarios;
        newPerms["perfis.criar"] = !!(menus.usuarios && acoes.criar);
        newPerms["perfis.editar"] = !!(menus.usuarios && acoes.editar);
        newPerms["perfis.excluir"] = !!(menus.usuarios && acoes.excluir);

        newPerms["auditoria.visualizar"] = !!menus.configuracoes;
        newPerms["auditoria.restaurar"] = !!menus.configuracoes;
        
        // Fill other missing keys as false
        listAllKeys.forEach(k => {
          if (newPerms[k] === undefined) {
            newPerms[k] = false;
          }
        });
      }

      await queryInterface.sequelize.query(
        `UPDATE "${currentSchema}"."perfis_acesso" SET "permissoes" = :permissoes WHERE "id" = :id;`,
        {
          replacements: {
            permissoes: JSON.stringify(newPerms),
            id: p.id
          },
          type: queryInterface.sequelize.QueryTypes.UPDATE
        }
      );
    }
  },

  async down(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    await queryInterface.removeColumn({ schema: currentSchema, tableName: 'perfis_acesso' }, 'alterado_por');
  }
};
