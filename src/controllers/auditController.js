import Cliente from '../models/Cliente.js';
import Colaborador from '../models/Colaborador.js';
import Servico from '../models/Servico.js';
import Produto from '../models/Produto.js';
import User from '../models/User.js';
import Agendamento from '../models/Agendamento.js';
import VendaDireta from '../models/VendaDireta.js';
import Despesa from '../models/Despesa.js';
import OutrasReceitas from '../models/OutrasReceitas.js';
import Categoria from '../models/Categoria.js';
import Fornecedor from '../models/Fornecedor.js';

const getDeletados = async (req, res) => {
  const { modulo } = req.query;

  try {
    let rawRecords = [];

    switch (modulo) {
      case 'cliente':
        rawRecords = await Cliente.findAll({ where: { deletado: 'S' }, order: [['deletado_em', 'DESC']] });
        break;
      case 'colaborador':
        rawRecords = await Colaborador.findAll({ where: { deletado: 'S' }, order: [['deletado_em', 'DESC']] });
        break;
      case 'servico':
        rawRecords = await Servico.findAll({ where: { deletado: 'S' }, order: [['deletado_em', 'DESC']] });
        break;
      case 'produto':
        rawRecords = await Produto.findAll({ where: { deletado: 'S' }, order: [['deletado_em', 'DESC']] });
        break;
      case 'usuario':
        rawRecords = await User.findAll({ where: { deletado: 'S' }, order: [['deletado_em', 'DESC']] });
        break;
      case 'agendamento':
        rawRecords = await Agendamento.findAll({ where: { deletado: 'S' }, order: [['deletado_em', 'DESC']] });
        break;
      case 'venda_direta':
      case 'venda':
        rawRecords = await VendaDireta.findAll({ where: { deletado: 'S' }, order: [['deletado_em', 'DESC']] });
        break;
      case 'despesa':
        rawRecords = await Despesa.findAll({ where: { deletado: 'S' }, order: [['deletado_em', 'DESC']] });
        break;
      case 'receita':
        rawRecords = await OutrasReceitas.findAll({ where: { deletado: 'S' }, order: [['deletado_em', 'DESC']] });
        break;
      case 'categoria':
        rawRecords = await Categoria.findAll({ where: { deletado: 'S' }, order: [['deletado_em', 'DESC']] });
        break;
      case 'fornecedor':
        rawRecords = await Fornecedor.findAll({ where: { deletado: 'S' }, order: [['deletado_em', 'DESC']] });
        break;
      default:
        return res.status(400).json({ detail: 'Módulo inválido para consulta de auditoria.' });
    }

    // Format all records into a standardized structure
    const formatted = rawRecords.map(r => {
      let descricao = '';
      
      if (modulo === 'cliente' || modulo === 'colaborador' || modulo === 'servico' || modulo === 'produto' || modulo === 'categoria') {
        descricao = r.nome;
      } else if (modulo === 'fornecedor') {
        descricao = r.nome_razosocial;
      } else if (modulo === 'usuario') {
        descricao = r.name || r.email;
      } else if (modulo === 'despesa' || modulo === 'receita') {
        descricao = `${r.descricao} (Valor: R$ ${Number(r.valor).toFixed(2)})`;
      } else if (modulo === 'agendamento') {
        // Agendamento description formatting
        const numServico = r.numero ? `${String(r.numero).padStart(6, '0')} | S` : 'N/A';
        const dataHora = r.data_hora ? new Date(r.data_hora).toLocaleString('pt-BR') : 'N/A';
        descricao = `${numServico} - Cliente: ${r.cliente_nome || 'N/A'} - Data: ${dataHora} - Total: R$ ${Number(r.valor_total).toFixed(2)}`;
      } else if (modulo === 'venda' || modulo === 'venda_direta') {
        // Venda description formatting
        const numVenda = r.numero_venda ? `${String(r.numero_venda).padStart(6, '0')} | V` : 'N/A';
        const dataVenda = r.data_venda ? new Date(r.data_venda).toLocaleString('pt-BR') : 'N/A';
        descricao = `${numVenda} - Cliente: ${r.cliente_nome || 'Consumidor'} - Data: ${dataVenda} - Total: R$ ${Number(r.valor_total).toFixed(2)}`;
      }

      return {
        id: r.id,
        descricao,
        deletado_por: r.deletado_por || 'Sistema',
        deletado_em: r.deletado_em
      };
    });

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const restoreRecord = async (req, res) => {
  const { modulo, id } = req.body;

  try {
    let model;
    switch (modulo) {
      case 'cliente':
        model = Cliente;
        break;
      case 'colaborador':
        model = Colaborador;
        break;
      case 'servico':
        model = Servico;
        break;
      case 'produto':
        model = Produto;
        break;
      case 'usuario':
        model = User;
        break;
      case 'agendamento':
        model = Agendamento;
        break;
      case 'venda_direta':
      case 'venda':
        model = VendaDireta;
        break;
      case 'despesa':
        model = Despesa;
        break;
      case 'receita':
        model = OutrasReceitas;
        break;
      case 'categoria':
        model = Categoria;
        break;
      case 'fornecedor':
        model = Fornecedor;
        break;
      default:
        return res.status(400).json({ detail: 'Módulo inválido para restauração.' });
    }

    const record = await model.findByPk(id);
    if (!record) {
      return res.status(404).json({ detail: 'Registro não encontrado.' });
    }

    if (record.deletado !== 'S') {
      return res.status(409).json({ detail: 'Este registro já está ativo e não pode ser restaurado.' });
    }

    await record.update({
      deletado: 'N',
      deletado_por: null,
      deletado_em: null
    });

    res.json({ ok: true, detail: 'Registro restaurado com sucesso.' });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export { getDeletados, restoreRecord };
