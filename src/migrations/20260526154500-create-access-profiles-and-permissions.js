export default {
  async up(queryInterface, Sequelize) {
    // 1. Create perfis_acesso table
    await queryInterface.createTable('perfis_acesso', {
      id: {
        type: Sequelize.STRING(36),
        primaryKey: true,
        allowNull: false
      },
      nome: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      descricao: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      permissoes: {
        type: Sequelize.TEXT, // Stores JSON string of permissions
        allowNull: false
      },
      ativo: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false
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

    // 2. Standard base profile UUIDs
    const adminId = 'admin-profile-uuid-0000000000000000000';
    const funcId = 'func-profile-uuid-0000000000000000000';

    const adminPerms = JSON.stringify({
      menus: {
        dashboard: true,
        agenda: true,
        clientes: true,
        servicos: true,
        colaboradores: true,
        produtos: true,
        estoque: true,
        vendas: true,
        despesas: true,
        receitas: true,
        comissoes: true,
        relatorios: true,
        configuracoes: true,
        usuarios: true
      },
      acoes: {
        criar: true,
        editar: true,
        excluir: true
      }
    });

    const funcPerms = JSON.stringify({
      menus: {
        dashboard: true,
        agenda: true,
        clientes: true,
        servicos: false,
        colaboradores: false,
        produtos: true,
        estoque: true,
        vendas: true,
        despesas: false,
        receitas: false,
        comissoes: false,
        relatorios: false,
        configuracoes: false,
        usuarios: false
      },
      acoes: {
        criar: true,
        editar: true,
        excluir: false
      }
    });

    await queryInterface.bulkInsert('perfis_acesso', [
      {
        id: adminId,
        nome: 'Administrador',
        descricao: 'Acesso total ao sistema com permissões administrativas e financeiras.',
        permissoes: adminPerms,
        ativo: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletado: 'N'
      },
      {
        id: funcId,
        nome: 'Funcionário',
        descricao: 'Acesso padrão operacional a agendamentos, clientes, estoque e vendas.',
        permissoes: funcPerms,
        ativo: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletado: 'N'
      }
    ]);

    // 3. Add column perfil_acesso_id to users table
    await queryInterface.addColumn('users', 'perfil_acesso_id', {
      type: Sequelize.STRING(36),
      allowNull: true,
      references: {
        model: 'perfis_acesso',
        key: 'id'
      }
    });

    // 4. Update existing users with correct perfil relationship
    await queryInterface.bulkUpdate('users', 
      { perfil_acesso_id: adminId }, 
      { role: 'admin' }
    );

    await queryInterface.bulkUpdate('users', 
      { perfil_acesso_id: funcId }, 
      { role: 'funcionario' }
    );
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('users', 'perfil_acesso_id');
    await queryInterface.dropTable('perfis_acesso');
  }
};
