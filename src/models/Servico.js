import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';
import { getTenantSchema } from '../config/tenantContext.js';

const Servico = sequelize.define('Servico', {
  id: {
    type: DataTypes.STRING(36),
    primaryKey: true,
    defaultValue: () => uuidv4()
  },
  nome: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  categoria_id: {
    type: DataTypes.STRING(36),
    allowNull: true
  },
  duracao_minutos: {
    type: DataTypes.INTEGER,
    defaultValue: 60
  },
  valor: {
    type: DataTypes.FLOAT,
    allowNull: false
  },
  descricao: {
    type: DataTypes.TEXT,
    defaultValue: ''
  },
  ativo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  produtos_vinculados: {
    type: DataTypes.TEXT,
    defaultValue: '[]',
    get() {
      const rawValue = this.getDataValue('produtos_vinculados');
      return rawValue ? JSON.parse(rawValue) : [];
    },
    set(value) {
      this.setDataValue('produtos_vinculados', JSON.stringify(value || []));
    }
  },
  criado_em: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  deletado: {
    type: DataTypes.STRING(1),
    defaultValue: 'N',
    allowNull: false
  },
  deletado_por: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  deletado_em: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'servicos'
});

export const getServicoModel = () => {
  const tenant = getTenantSchema();
  return Servico.schema(tenant);
};

export default Servico;
