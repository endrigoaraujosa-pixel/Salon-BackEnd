const migration = {
  async up(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    
    // Obter todos os perfis de acesso existentes no schema atual
    const perfis = await queryInterface.sequelize.query(
      `SELECT id, nome, permissoes FROM "${currentSchema}"."perfis_acesso";`,
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    );

    for (const p of perfis) {
      let perms = {};
      try {
        perms = typeof p.permissoes === 'string' ? JSON.parse(p.permissoes) : (p.permissoes || {});
      } catch (e) {
        perms = {};
      }

      // Se a permissão não existir, inicializar
      if (perms['relatorios.cancelados'] === undefined) {
        const isAdmin = p.nome === 'Administrador' || perms['is_admin'] === true || perms.acoes?.is_admin === true;
        
        // Copiar o acesso se já tinha acesso a relatorios.vendas ou se é administrador
        perms['relatorios.cancelados'] = isAdmin || !!perms['relatorios.vendas'];
        
        await queryInterface.sequelize.query(
          `UPDATE "${currentSchema}"."perfis_acesso" SET "permissoes" = :perms WHERE "id" = :id;`,
          {
            replacements: { perms: JSON.stringify(perms), id: p.id },
            type: queryInterface.sequelize.QueryTypes.UPDATE
          }
        );
      }
    }
  },

  async down(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    
    const perfis = await queryInterface.sequelize.query(
      `SELECT id, nome, permissoes FROM "${currentSchema}"."perfis_acesso";`,
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    );

    for (const p of perfis) {
      let perms = {};
      try {
        perms = typeof p.permissoes === 'string' ? JSON.parse(p.permissoes) : (p.permissoes || {});
      } catch (e) {
        perms = {};
      }

      if (perms['relatorios.cancelados'] !== undefined) {
        delete perms['relatorios.cancelados'];
        
        await queryInterface.sequelize.query(
          `UPDATE "${currentSchema}"."perfis_acesso" SET "permissoes" = :perms WHERE "id" = :id;`,
          {
            replacements: { perms: JSON.stringify(perms), id: p.id },
            type: queryInterface.sequelize.QueryTypes.UPDATE
          }
        );
      }
    }
  }
};

export default migration;
