({
    /**
     * @description: clears all info on user-selected open donation
     */
    clearDonationSelectionOptions: function(component) {
        component.set('v.selectedDonation', null);
        component.set('v.openOpportunities', null);
        component.set('v.unpaidPayments', null);
    },

    /**
     * @description: sets the value of the selected donation
     */
    setDonation: function(component, selectedDonation) {
        component.set('v.selectedDonation', selectedDonation);
    },

    /**
     * @description: adds hidden and non-lightning:inputfield fields to the Data Import record before submitting.
     * @return: Object rowFields with hidden fields added
     */
    getRowWithHiddenFields: function (component, event) {
        let rowFields = event.getParam('fields');
        const labels = component.get('v.labels');

        const recId = component.get('v.recordId');
        rowFields[labels.batchIdField] = recId;

        // add donor type hidden fields
        var donorType = component.get('v.donorType');
        rowFields[labels.donationDonor] = donorType;

        // add any picklist fields manually, because they use lightning:select
        var dynamicInputFields = component.find('dynamicInputFields');
        var dataImportFields = component.get('v.dataImportFields');

        //dataImportFields and dynamicInputFields have the same order, so can loop both to get the value
        for (var i=0; i<dataImportFields.length; i++) {
            if (dataImportFields[i].options && dataImportFields[i].options.length > 0) {
                var fieldValue = dynamicInputFields[i].get('v.value');
                var fieldName = dataImportFields[i].name;
                rowFields[fieldName] = fieldValue;
            }
        }

        // assign opportunity/payment lookup and import status
        const selectedDonation = component.get('v.selectedDonation');
        const userSelectedMatch = $A.get('$Label.c.bdiMatchedByUser');
        const userSelectedNewOpp = $A.get('$Label.c.bdiMatchedByUserNewOpp');
        const applyNewPayment = $A.get('$Label.c.bdiMatchedApplyNewPayment');

        if (selectedDonation) {
            if (selectedDonation.attributes.type === 'Opportunity') {
                //matched opportunity; create new payment or update opportunity
                rowFields[labels.opportunityImportedLookupField] = selectedDonation.Id;
                if (selectedDonation.applyPayment) {
                    rowFields[labels.opportunityImportedStatusField] = applyNewPayment;
                } else {
                    rowFields[labels.opportunityImportedStatusField] = userSelectedMatch;
                }
            } else {
                //matched payment; update payment
                rowFields[labels.paymentImportedLookupField] = selectedDonation.Id;
                rowFields[labels.paymentImportedStatusField] = userSelectedMatch;
                rowFields[labels.opportunityImportedLookupField] = selectedDonation.npe01__Opportunity__c;
                rowFields[labels.opportunityImportedStatusField] = userSelectedMatch;
            }
        } else if (selectedDonation === '') {
            //create new opportunity if selectedDonation is set as empty string
            //else status fields are left null to allow for dry-run
            rowFields[labels.opportunityImportedStatusField] = userSelectedNewOpp;
        }

        return rowFields;
    },

    /**
     * @description: queries open donations for upcoming donations
     * @return: void
     */
    queryOpenDonations: function (component, donorId) {
        const donorType = component.get('v.donorType');

        let action = component.get('c.getOpenDonations');
        action.setParams({donorId: donorId, donorType: donorType});
        action.setCallback(this, function (response) {
            const state = response.getState();
            if (state === 'SUCCESS') {
                const openDonations = JSON.parse(response.getReturnValue());
                component.set('v.openOpportunities', openDonations.openOpportunities);
                component.set('v.unpaidPayments', openDonations.unpaidPayments);

            } else {
                const errors = response.getError();
                if (errors) {
                    if (errors[0] && errors[0].message) {
                        this.sendMessage('onError', {title: $A.get('$Label.c.PageMessagesError'), errorMessage: errors[0].message});
                    } else {
                        this.sendMessage('onError', {title: $A.get('$Label.c.PageMessagesError'), errorMessage: $A.get('$Label.c.stgUnknownError')});
                    }
                }
            }
            this.sendMessage('hideFormSpinner', '');
            const matchLink = document.getElementById('selectMatchLink');
            matchLink.focus();
        });
        $A.enqueueAction(action);
    },

    /**
     * @description: sends error toast to parent component notifying user of missing fields
     * @param missingFields: Array of missing fields
     */
    sendErrorToast: function(component, missingFields) {
        var channel = 'onError';
        var error = $A.get('$Label.c.exceptionRequiredField') + ' ' + missingFields.join(', ') + '.';
        var message = {title: $A.get('$Label.c.PageMessagesError'), errorMessage: error};
        this.sendMessage(channel, message);
    },

    /**
     * @description: send a message to other components
     */
    sendMessage: function (channel, message) {
        var sendMessage = $A.get('e.ltng:sendMessage');
        sendMessage.setParams({
            'channel': channel,
            'message': message
        });
        sendMessage.fire();
    },

    /**
     * @description: checks for Donor and other required fields and gathers error messages before submitting
     * @return: validity Object with Boolean for validity and an array of any missing fields to display
     */
    validateFields: function(component, rowFields) {
        var validity = {isValid: true, missingFields: []};

        var hasDonor = this.verifyRowHasDonor(component, rowFields);
        if (!hasDonor) {
            var labels = component.get("v.labels");
            var missingDonor = (component.get("v.donorType") === 'Contact1') ? labels.contactObject : labels.accountObject;
            validity.missingFields.push(missingDonor);
        }

        var missingRequiredFields = this.verifyRequiredFields(component, rowFields);
        if (missingRequiredFields.length != 0) {
            validity.missingFields = validity.missingFields.concat(missingRequiredFields);
        }

        if (validity.missingFields.length !== 0) {
            validity.isValid = false;
        }

        return validity;
    },

    /**
     * @description: checks for presence of fields that user has marked as required
     * @param rowFields: Object rowFields with updated hidden values
     * @return missingFields: list of any fields by label that are missing
     */
    verifyRequiredFields: function(component, rowFields) {
        var missingFields = [];
        var dataImportFields = component.get('v.dataImportFields');
        var dynamicInputFields = component.find('dynamicInputFields');

        if (! Array.isArray(dynamicInputFields)) {
            dynamicInputFields = [dynamicInputFields];
        }

        //dataImportFields and dynamicInputFields have the same order, so can loop both to check validity
        for (var i=0; i<dataImportFields.length; i++) {
            if (dataImportFields[i].required) {
                var fieldValue = dynamicInputFields[i].get('v.value');
                if (fieldValue === '' || fieldValue === null) {
                    missingFields.push(dataImportFields[i].label);
                }
            }
        }

        return missingFields;
    },

    /**
     * @description: checks for presence of a donor, which is always required
     * @param rowFields: Object rowFields with updated hidden values
     * @return hasDonor: Boolean to indicate if row has a donor
     */
    verifyRowHasDonor: function(component, rowFields) {
        var hasDonor = true;
        var lookupValue;

        if (component.get("v.donorType") === 'Contact1') {
            lookupValue = rowFields[component.get("v.labels.contactLookup")];
        } else if (component.get("v.donorType") === 'Account1') {
            lookupValue = rowFields[component.get("v.labels.accountLookup")];
        }

        if (!lookupValue || lookupValue.length !== 18) {
            hasDonor = false;
        }

        return hasDonor;
    }

})