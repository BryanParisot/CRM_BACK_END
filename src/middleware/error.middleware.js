// Express reconnaît les gestionnaires d’erreur grâce à leurs quatre paramètres.
export const handleVehiclePreferencesError = (error, req, res, next) => {
    if (!error.status) console.error('Recherche véhicule :', error.message);
    res.status(error.status || 500).json({message: error.status ? error.message : 'Impossible d’enregistrer les véhicules recherchés.'});
};

export const handleSettlementError = (error, req, res, next) => {
    if (!error.status)
        console.error('Solde :', error.message);
    res.status(error.status || 500).json({ message: error.status ? error.message : 'Impossible de traiter le récapitulatif.' });
};
export const handleDeliveryError = (error, req, res, next) => {
    if (!error.status)
        console.error('Livraison :', error.message);
    res.status(error.status || 500).json({ message: error.status ? error.message : 'Impossible de traiter les informations de livraison.' });
};
export const handleDocumentError = (error, req, res, next) => {
    console.error('Documents:', error.message);
    res.status(error.status || (error.type === 'entity.too.large' ? 413 : 500)).json({ message: error.type === 'entity.too.large' ? 'Le fichier dépasse 10 Mo.' : error.status ? error.message : 'Impossible de traiter le document.' });
};
