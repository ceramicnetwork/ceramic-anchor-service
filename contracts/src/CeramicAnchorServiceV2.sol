// SPDX-License-Identifier: GPL
pragma solidity ^0.8.13;

import "@openzeppelin/contracts/access/Ownable.sol";


contract CeramicAnchorServiceV2 is Ownable {

    //the list of addresses
    mapping (address => bool) allowList;

    //when a service is added to allow list 
    event DidAddCas(address indexed _service);

    //when a service was removed from allow list
    event DidRemoveCas(address indexed _service);

    //upon successful anchor
    event DidAnchor(address indexed _service, bytes _root);
    // event DidAnchor(address indexed _service, bytes32 _root);

    // Only an address in the allow list is allowed to anchor
    // TODO: upon contract creation, allowList is blank, so nobody is allowed
    modifier onlyAllowed() {
        //NOTE: this assumes msg.sender has already been added to allow list on creation if this is the first anchor attempt
        //NOTE: adding msg.sender to condition ensures owner can add first entry to allow list
        //NOTE: can also add msg.sender as first enty upon contract creation (constructor)
        // require(allowList[ msg.sender ].allowed, "Allow List: caller is not allowed");
        require(
            ( allowList[ msg.sender ] || msg.sender == owner() ), 
            "Allow List: caller is not allowed");
        _;
    }

    constructor(){
        // TODO: should we add owner address to allowList upon contract creation
    }

    /*
        @name addCas
        @param address _service - the service to be added
        @desc add an address to the allow list
        @note Only owner can add to the allowlist
    */
    function addCas(address _service) public onlyOwner {
        // allowList[_service] = Service(true);
        allowList[_service] = true;
        emit DidAddCas(_service);
    }
        
    /*
        @name removeCas
        @param address _service - service to be removed
        @desc Removal can be performed by the owner or the service itself
    */
    function removeCas(address _service) public {
        // require((owner() == _msgSender()) || (allowList[_msgSender()].allowed && _msgSender() == _service), "Caller is not allowed or the owner");
        require((owner() == _msgSender()) || (allowList[_msgSender()] && _msgSender() == _service), "Caller is not allowed or the owner");
        delete allowList[_service];
        emit DidRemoveCas(_service);
    }

    /*
        @name isServiceAllowed
        @param address _service - address to check
        @desc check if a service/address is allowed
    */
    function isServiceAllowed(address _service) public view returns(bool) {
        return allowList[_service];
    }

    /* 
        @name anchor
        @param calldata _root
        @desc Here _root is a byte representation of Merkle root CID.
    */
    function anchor(bytes calldata _root) public onlyAllowed {
    // function anchor(bytes32 calldata _root1, bytes32 calldata _root2, bytes8 calldata _root3) public onlyAllowed {
        emit DidAnchor(msg.sender, _root);
    }
    
}
