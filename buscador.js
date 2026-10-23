const Fuse = require('fuse.js');
const fs = require('fs');

function buscarBeneficios(query) {
    if (!fs.existsSync('beneficios.json')) return [];
    
    try {
        const rawData = fs.readFileSync('beneficios.json', 'utf-8');
        const data = JSON.parse(rawData);
        
        if (!query || query.trim() === '') {
            return data;
        }

        const fuse = new Fuse(data, {
            keys: ['titulo', 'descripcion', 'codigoDescuento', 'zona'],
            threshold: 0.4,
            ignoreLocation: true
        });

        const resultados = fuse.search(query.trim());
        return resultados.map(res => res.item);

    } catch (error) {
        console.error('❌ Error al leer o parsear beneficios.json:', error.message);
        return [];
    }
}

/**
 * Obtiene la lista única de zonas geográficas almacenadas en beneficios.json
 */
function obtenerZonasUnicas() {
    if (!fs.existsSync('beneficios.json')) return [];
    try {
        const rawData = fs.readFileSync('beneficios.json', 'utf-8');
        const data = JSON.parse(rawData);
        const zonas = [...new Set(data.map(item => item.zona).filter(Boolean))];
        return zonas.sort();
    } catch (error) {
        console.error('❌ Error al obtener zonas:', error.message);
        return [];
    }
}

module.exports = { buscarBeneficios, obtenerZonasUnicas };